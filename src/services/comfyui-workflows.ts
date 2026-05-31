import * as fs from 'fs/promises';
import * as path from 'path';

export type WorkflowType = 'image' | 'video';

export interface InjectionPoint {
  nodeId: string;
  field: string;
}

export interface WorkflowInjections {
  prompt?: InjectionPoint;
  negativePrompt?: InjectionPoint;
  seed?: InjectionPoint;
  width?: InjectionPoint;
  height?: InjectionPoint;
  inputImage?: InjectionPoint;
  [key: string]: InjectionPoint | undefined;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  type: WorkflowType;
  description: string;
  injections: WorkflowInjections;
  workflow: Record<string, unknown>;
  source: 'bundled' | 'workspace';
}

export interface InjectParamsInput {
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  inputImage?: string;
  extraParams?: Record<string, unknown>;
}

const PARAM_TO_INJECTION: Record<string, keyof WorkflowInjections> = {
  prompt: 'prompt',
  negativePrompt: 'negativePrompt',
  seed: 'seed',
  width: 'width',
  height: 'height',
  inputImage: 'inputImage',
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function setNodeField(
  graph: Record<string, { inputs?: Record<string, unknown>; class_type?: string }>,
  nodeId: string,
  field: string,
  value: unknown,
): void {
  const node = graph[nodeId];
  if (!node) {
    throw new Error(`Workflow node "${nodeId}" not found for injection field "${field}"`);
  }
  if (!node.inputs) node.inputs = {};
  node.inputs[field] = value;
}

export function injectParams(definition: WorkflowDefinition, params: InjectParamsInput): Record<string, unknown> {
  const graph = deepClone(definition.workflow) as Record<string, { inputs?: Record<string, unknown> }>;
  for (const [paramKey, injectionKey] of Object.entries(PARAM_TO_INJECTION)) {
    const injection = definition.injections[injectionKey];
    const value = params[paramKey as keyof InjectParamsInput];
    if (!injection || value === undefined || value === null) continue;
    setNodeField(graph, injection.nodeId, injection.field, value);
  }
  if (params.extraParams) {
    for (const [key, value] of Object.entries(params.extraParams)) {
      const injection = definition.injections[key];
      if (injection && value !== undefined) {
        setNodeField(graph, injection.nodeId, injection.field, value);
      }
    }
  }
  return graph;
}

async function loadWorkflowFile(filePath: string, source: 'bundled' | 'workspace'): Promise<WorkflowDefinition | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeWorkflowInput(parsed, path.basename(filePath));
    return { ...normalized, source };
  } catch (err: any) {
    console.warn(`[ComfyUI] Skipped workflow file ${filePath}: ${err.message}`);
    return null;
  }
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

const VIDEO_NODE_HINTS = ['SaveAnimatedWEBP', 'VHS_VideoCombine', 'SaveVideo', 'AnimateDiff', 'VideoCombine'];
const LATENT_NODE_TYPES = ['EmptyLatentImage', 'EmptySD3LatentImage', 'EmptyZImageLatentImage'];

function hasSubgraphStyleNodeIds(graph: Record<string, unknown>): boolean {
  return Object.keys(graph).some((id) => id.includes(':'));
}

function remapWorkflowReferences(value: unknown, idMap: Map<string, string>): unknown {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number') {
    const mapped = idMap.get(value[0]);
    return mapped ? [mapped, value[1]] : value;
  }
  if (Array.isArray(value)) return value.map((item) => remapWorkflowReferences(item, idMap));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, remapWorkflowReferences(item, idMap)]),
    );
  }
  return value;
}

export function flattenApiGraphNodeIds(
  graph: Record<string, { class_type?: string; inputs?: Record<string, unknown>; _meta?: unknown }>,
): { graph: Record<string, { class_type?: string; inputs?: Record<string, unknown>; _meta?: unknown }>; warnings: string[] } {
  if (!hasSubgraphStyleNodeIds(graph)) return { graph, warnings: [] };
  const idMap = new Map<string, string>();
  let nextId = 1;
  const sortedIds = [...Object.keys(graph)].sort((a, b) => {
    const aPrefix = Number(a.split(':')[0]);
    const bPrefix = Number(b.split(':')[0]);
    if (!Number.isNaN(aPrefix) && !Number.isNaN(bPrefix) && aPrefix !== bPrefix) return aPrefix - bPrefix;
    return a.localeCompare(b);
  });
  for (const oldId of sortedIds) idMap.set(oldId, String(nextId++));
  const flat: Record<string, { class_type?: string; inputs?: Record<string, unknown>; _meta?: unknown }> = {};
  for (const [oldId, node] of Object.entries(graph)) {
    const newId = idMap.get(oldId)!;
    const cloned = deepClone(node);
    if (cloned.inputs) cloned.inputs = remapWorkflowReferences(cloned.inputs, idMap) as Record<string, unknown>;
    flat[newId] = cloned;
  }
  return {
    graph: flat,
    warnings: [
      `Renumbered ${sortedIds.length} subgraph-style node IDs (e.g. "${sortedIds.find((id) => id.includes(':'))}") to flat API IDs ("1", "2", …).`,
    ],
  };
}

function isRawComfyGraph(value: unknown): value is Record<string, { class_type?: string; inputs?: Record<string, unknown> }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.some(([, node]) => node && typeof node === 'object' && 'class_type' in (node as object));
}

function isComfyUiEditorFormat(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.nodes) && (Array.isArray(obj.links) || obj.version !== undefined);
}

function extractComfyPromptGraph(parsed: unknown): Record<string, { class_type?: string; inputs?: Record<string, unknown> }> | null {
  if (isRawComfyGraph(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.prompt && isRawComfyGraph(obj.prompt)) return obj.prompt;
  if (obj.workflow && isRawComfyGraph(obj.workflow)) return obj.workflow as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
  return null;
}

const UI_FORMAT_HINT =
  'This file is ComfyUI UI/editor format (nodes + links). In ComfyUI use Workflow → Save (API Format), or install the Workflow-to-API Converter custom node so Admin import can auto-convert.';

export interface NormalizeWorkflowResult {
  definition: Omit<WorkflowDefinition, 'source'>;
  warnings: string[];
}

function finalizeImportedGraph(
  definition: Omit<WorkflowDefinition, 'source'>,
): NormalizeWorkflowResult {
  const graph = definition.workflow as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
  const { graph: flatGraph, warnings } = flattenApiGraphNodeIds(graph);
  if (warnings.length === 0) return { definition, warnings: [] };
  return {
    definition: {
      ...definition,
      workflow: flatGraph,
      injections: suggestInjections(flatGraph),
    },
    warnings,
  };
}

export function detectWorkflowType(workflow: Record<string, { class_type?: string }>): WorkflowType {
  for (const node of Object.values(workflow)) {
    const classType = node.class_type ?? '';
    if (VIDEO_NODE_HINTS.some((hint) => classType.includes(hint))) return 'video';
  }
  return 'image';
}

export function suggestInjections(
  workflow: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>,
): WorkflowInjections {
  const injections: WorkflowInjections = {};
  const clipNodes: string[] = [];
  let ksamplerId: string | undefined;
  let latentId: string | undefined;
  let loadImageId: string | undefined;
  for (const [nodeId, node] of Object.entries(workflow)) {
    const classType = node.class_type ?? '';
    if (classType === 'CLIPTextEncode') clipNodes.push(nodeId);
    if (classType === 'KSampler' || classType === 'KSamplerAdvanced') ksamplerId = nodeId;
    if (LATENT_NODE_TYPES.includes(classType)) latentId = nodeId;
    if (classType === 'LoadImage') loadImageId = nodeId;
  }
  if (clipNodes.length >= 1) injections.prompt = { nodeId: clipNodes[0], field: 'text' };
  if (clipNodes.length >= 2) injections.negativePrompt = { nodeId: clipNodes[1], field: 'text' };
  if (ksamplerId) injections.seed = { nodeId: ksamplerId, field: 'seed' };
  if (latentId) {
    injections.width = { nodeId: latentId, field: 'width' };
    injections.height = { nodeId: latentId, field: 'height' };
  }
  if (loadImageId) injections.inputImage = { nodeId: loadImageId, field: 'image' };
  return injections;
}

function slugifyId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/(^-|-$)/g, '') || `workflow-${Date.now()}`;
}

function buildWorkflowDefinition(parsed: unknown, filename?: string): Omit<WorkflowDefinition, 'source'> {
  if (isComfyUiEditorFormat(parsed)) {
    throw new Error(UI_FORMAT_HINT);
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (obj.id && obj.workflow && isRawComfyGraph(obj.workflow)) {
      return {
        id: String(obj.id),
        name: String(obj.name ?? obj.id),
        type: (obj.type === 'video' ? 'video' : 'image') as WorkflowType,
        description: String(obj.description ?? ''),
        injections: (obj.injections as WorkflowInjections) ?? suggestInjections(obj.workflow as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>),
        workflow: obj.workflow as Record<string, unknown>,
      };
    }
    if (obj.workflow && isRawComfyGraph(obj.workflow) && !obj.id) {
      const baseId = slugifyId(filename?.replace(/\.json$/i, '') ?? `imported-${Date.now()}`);
      const graph = obj.workflow as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
      return {
        id: baseId,
        name: String(obj.name ?? baseId),
        type: detectWorkflowType(graph),
        description: String(obj.description ?? (filename ? `Imported from ${filename}` : 'Imported workflow')),
        injections: (obj.injections as WorkflowInjections) ?? suggestInjections(graph),
        workflow: graph as Record<string, unknown>,
      };
    }
    const graph = extractComfyPromptGraph(parsed);
    if (graph) {
      const baseId = slugifyId(filename?.replace(/\.json$/i, '') ?? `imported-${Date.now()}`);
      return {
        id: baseId,
        name: baseId,
        type: detectWorkflowType(graph),
        description: filename ? `Imported from ${filename}` : 'Imported ComfyUI workflow',
        injections: suggestInjections(graph),
        workflow: graph as Record<string, unknown>,
      };
    }
  }
  throw new Error(`Invalid workflow JSON: expected VoiceClaw wrapper or ComfyUI API graph (Save API Format). ${UI_FORMAT_HINT}`);
}

export function normalizeWorkflowInput(parsed: unknown, filename?: string): Omit<WorkflowDefinition, 'source'> {
  return finalizeImportedGraph(buildWorkflowDefinition(parsed, filename)).definition;
}

export async function normalizeWorkflowForImport(
  parsed: unknown,
  filename?: string,
  convertViaServer?: (workflow: unknown) => Promise<unknown | null>,
): Promise<NormalizeWorkflowResult> {
  const warnings: string[] = [];
  let input = parsed;
  if (isComfyUiEditorFormat(parsed)) {
    if (convertViaServer) {
      const converted = await convertViaServer(parsed);
      const convertedGraph = converted ? extractComfyPromptGraph(converted) : null;
      if (convertedGraph) {
        warnings.push('Converted ComfyUI UI workflow to API format using the ComfyUI server.');
        input = convertedGraph;
      }
    }
    if (isComfyUiEditorFormat(input)) {
      throw new Error(UI_FORMAT_HINT);
    }
  }
  const finalized = finalizeImportedGraph(buildWorkflowDefinition(input, filename));
  return {
    definition: finalized.definition,
    warnings: [...warnings, ...finalized.warnings],
  };
}

export class WorkflowRegistry {
  private workflows = new Map<string, WorkflowDefinition>();
  private bundledDir: string;
  private workspaceDir: string;

  constructor() {
    this.bundledDir = path.join(process.cwd(), 'template', 'comfyui');
    this.workspaceDir = path.join(process.cwd(), 'workspace', 'comfyui', 'workflows');
  }

  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.workspaceDir, { recursive: true });
    await this.reload();
  }

  async reload(): Promise<void> {
    this.workflows.clear();
    const bundledFiles = await listJsonFiles(this.bundledDir);
    for (const file of bundledFiles) {
      const def = await loadWorkflowFile(file, 'bundled');
      if (def) this.workflows.set(def.id, def);
    }
    const workspaceFiles = await listJsonFiles(this.workspaceDir);
    for (const file of workspaceFiles) {
      const def = await loadWorkflowFile(file, 'workspace');
      if (def) this.workflows.set(def.id, def);
    }
    console.log(`[ComfyUI] Loaded ${this.workflows.size} workflow(s).`);
  }

  list(): WorkflowDefinition[] {
    return Array.from(this.workflows.values()).sort((a, b) => {
      if (a.source === 'workspace' && b.source !== 'workspace') return -1;
      if (b.source === 'workspace' && a.source !== 'workspace') return 1;
      return a.id.localeCompare(b.id);
    });
  }

  get(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  async saveToWorkspace(definition: Omit<WorkflowDefinition, 'source'>): Promise<WorkflowDefinition> {
    if (!definition.id || !definition.workflow) {
      throw new Error('Workflow id and workflow graph are required');
    }
    await fs.mkdir(this.workspaceDir, { recursive: true });
    const filePath = path.join(this.workspaceDir, `${definition.id}.json`);
    const payload = {
      id: definition.id,
      name: definition.name,
      type: definition.type,
      description: definition.description,
      injections: definition.injections,
      workflow: definition.workflow,
    };
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    const saved: WorkflowDefinition = { ...payload, source: 'workspace' };
    this.workflows.set(saved.id, saved);
    return saved;
  }

  async deleteFromWorkspace(id: string): Promise<boolean> {
    const existing = this.workflows.get(id);
    if (!existing || existing.source !== 'workspace') return false;
    const filePath = path.join(this.workspaceDir, `${id}.json`);
    await fs.unlink(filePath).catch(() => undefined);
    this.workflows.delete(id);
    const bundled = await loadWorkflowFile(path.join(this.bundledDir, `${id}.json`), 'bundled');
    if (bundled) this.workflows.set(id, bundled);
    return true;
  }
}

export const workflowRegistry = new WorkflowRegistry();
