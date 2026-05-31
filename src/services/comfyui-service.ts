import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { configManager } from '../config/index';
import { modelLoadCoordinator } from '../models/model-load-coordinator';
import { getAgentRunContext, toTaskArtifactScope } from '../agents/agent-run-context';
import { copyFileIntoTaskArtifacts } from '../orchestration/task-artifacts';
import { comfyUIClient, ComfyUIHistoryOutput } from './comfyui-client';
import { injectParams, workflowRegistry, WorkflowDefinition, WorkflowInjections, normalizeWorkflowInput, normalizeWorkflowForImport, suggestInjections, detectWorkflowType } from './comfyui-workflows';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface GenerateOutput {
  filename: string;
  localPath: string;
  url: string;
  type: 'image' | 'video';
}

export interface GenerateRequest {
  workflowId: string;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  inputImagePath?: string;
  extraParams?: Record<string, unknown>;
  waitForCompletion?: boolean;
}

export interface GenerateResult {
  promptId: string;
  status: JobStatus;
  outputs: GenerateOutput[];
  error?: string;
}

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  async acquire(max: number): Promise<() => void> {
    if (this.active < max) {
      this.active++;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    return () => this.release();
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

function isVideoFilename(name: string): boolean {
  return /\.(mp4|webm|gif|avi|mov)$/i.test(name);
}

function collectHistoryOutputs(history: { outputs?: Record<string, { images?: ComfyUIHistoryOutput[]; gifs?: ComfyUIHistoryOutput[]; videos?: ComfyUIHistoryOutput[] }> }): ComfyUIHistoryOutput[] {
  const items: ComfyUIHistoryOutput[] = [];
  if (!history.outputs) return items;
  for (const nodeOutput of Object.values(history.outputs)) {
    if (nodeOutput.images) items.push(...nodeOutput.images);
    if (nodeOutput.gifs) items.push(...nodeOutput.gifs);
    if (nodeOutput.videos) items.push(...nodeOutput.videos);
  }
  return items;
}

export class ComfyUIService {
  private jobs = new Map<string, GenerateResult>();
  private semaphore = new Semaphore();

  private getMaxConcurrentJobs(): number {
    return Math.max(1, configManager.getConfig().comfyui.maxConcurrentJobs);
  }

  private assertEnabled(): void {
    if (!configManager.getConfig().comfyui.enabled) {
      throw new Error('ComfyUI integration is disabled. Set comfyui.enabled to true in workspace/config.json');
    }
  }

  private resolveOutputDir(): string {
    const cfg = configManager.getConfig().comfyui.outputDir;
    return path.isAbsolute(cfg) ? cfg : path.join(process.cwd(), cfg);
  }

  private shouldUnloadLocalModel(): boolean {
    return configManager.getConfig().comfyui.unloadLocalModelOnGenerate !== false;
  }

  private async runJobWithGpuHandoff<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.shouldUnloadLocalModel()) {
      return fn();
    }
    await modelLoadCoordinator.suspendForGpuWork();
    try {
      return await fn();
    } finally {
      await modelLoadCoordinator.restoreAfterGpuWork();
    }
  }

  async initialize(): Promise<void> {
    await workflowRegistry.initialize();
  }

  async healthCheck() {
    const cfg = configManager.getConfig().comfyui;
    if (!cfg.enabled) {
      return { enabled: false, reachable: false, baseUrl: configManager.getComfyUIBaseUrl(), queuePending: 0, queueRunning: 0, details: 'ComfyUI integration disabled' };
    }
    const status = await comfyUIClient.healthCheck();
    return { enabled: true, ...status };
  }

  listWorkflows() {
    return workflowRegistry.list().map((w) => ({
      id: w.id,
      name: w.name,
      type: w.type,
      description: w.description,
      source: w.source,
    }));
  }

  getWorkflow(id: string): WorkflowDefinition | undefined {
    return workflowRegistry.get(id);
  }

  async listComfyUIUserWorkflows(): Promise<string[]> {
    this.assertEnabled();
    const health = await comfyUIClient.healthCheck();
    if (!health.reachable) {
      throw new Error(`ComfyUI server unreachable: ${health.details ?? 'unknown error'}`);
    }
    return comfyUIClient.listUserDataWorkflows();
  }

  async previewComfyUIUserWorkflow(filename: string): Promise<{ filename: string; suggested: Omit<WorkflowDefinition, 'source'>; warnings: string[] }> {
    this.assertEnabled();
    const raw = await comfyUIClient.getUserDataWorkflow(filename);
    const { definition, warnings } = await normalizeWorkflowForImport(raw, filename, (workflow) => comfyUIClient.convertWorkflowToApi(workflow));
    return { filename, suggested: definition, warnings };
  }

  async importComfyUIUserWorkflow(input: {
    filename: string;
    id?: string;
    name?: string;
    type?: 'image' | 'video';
    description?: string;
    injections?: WorkflowInjections;
  }): Promise<WorkflowDefinition> {
    this.assertEnabled();
    const raw = await comfyUIClient.getUserDataWorkflow(input.filename);
    const { definition: normalized } = await normalizeWorkflowForImport(raw, input.filename, (workflow) => comfyUIClient.convertWorkflowToApi(workflow));
    const definition: Omit<WorkflowDefinition, 'source'> = {
      id: input.id ?? normalized.id,
      name: input.name ?? normalized.name,
      type: input.type ?? normalized.type,
      description: input.description ?? normalized.description,
      injections: input.injections ?? normalized.injections,
      workflow: normalized.workflow,
    };
    return workflowRegistry.saveToWorkspace(definition);
  }

  async uploadWorkflow(buffer: Buffer, filename?: string): Promise<WorkflowDefinition> {
    this.assertEnabled();
    const parsed = JSON.parse(buffer.toString('utf-8')) as unknown;
    const { definition: normalized } = await normalizeWorkflowForImport(parsed, filename, (workflow) => comfyUIClient.convertWorkflowToApi(workflow));
    return workflowRegistry.saveToWorkspace(normalized);
  }

  async updateWorkflow(id: string, patch: {
    name?: string;
    type?: 'image' | 'video';
    description?: string;
    injections?: WorkflowInjections;
    workflow?: Record<string, unknown>;
  }): Promise<WorkflowDefinition> {
    this.assertEnabled();
    const existing = workflowRegistry.get(id);
    if (!existing) throw new Error(`Workflow not found: ${id}`);
    if (existing.source !== 'workspace') {
      throw new Error(`Cannot edit bundled workflow "${id}". Save a copy to workspace first.`);
    }
    const updated: Omit<WorkflowDefinition, 'source'> = {
      id: existing.id,
      name: patch.name ?? existing.name,
      type: patch.type ?? existing.type,
      description: patch.description ?? existing.description,
      injections: patch.injections ?? existing.injections,
      workflow: patch.workflow ?? existing.workflow,
    };
    return workflowRegistry.saveToWorkspace(updated);
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    this.assertEnabled();
    const deleted = await workflowRegistry.deleteFromWorkspace(id);
    if (!deleted) throw new Error(`Cannot delete workflow "${id}" (not found or bundled)`);
    return true;
  }

  suggestInjectionsForGraph(workflow: Record<string, unknown>): WorkflowInjections {
    return suggestInjections(workflow as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>);
  }

  detectWorkflowTypeForGraph(workflow: Record<string, unknown>): 'image' | 'video' {
    return detectWorkflowType(workflow as Record<string, { class_type?: string }>);
  }

  getJob(promptId: string): GenerateResult | undefined {
    return this.jobs.get(promptId);
  }

  async reloadWorkflows(): Promise<number> {
    await workflowRegistry.reload();
    return workflowRegistry.list().length;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.assertEnabled();
    const workflowDef = workflowRegistry.get(request.workflowId);
    if (!workflowDef) {
      throw new Error(`Workflow not found: ${request.workflowId}. Call list workflows first.`);
    }
    const health = await comfyUIClient.healthCheck();
    if (!health.reachable) {
      throw new Error(`ComfyUI server unreachable at ${configManager.getComfyUIBaseUrl()}: ${health.details ?? 'unknown error'}`);
    }
    console.log(`[ComfyUI] Starting generate workflow=${request.workflowId} wait=${request.waitForCompletion !== false}`);
    const release = await this.semaphore.acquire(this.getMaxConcurrentJobs());
    console.log(`[ComfyUI] Acquired job slot (maxConcurrent=${this.getMaxConcurrentJobs()})`);
    const clientId = randomUUID();
    const promptIdRef: { value?: string } = {};
    let releaseCalled = false;
    const doRelease = (): void => {
      if (releaseCalled) return;
      releaseCalled = true;
      release();
    };
    try {
      let inputImageName: string | undefined;
      if (request.inputImagePath) {
        const absPath = path.isAbsolute(request.inputImagePath)
          ? request.inputImagePath
          : path.join(process.cwd(), request.inputImagePath);
        const buffer = await fs.readFile(absPath);
        const uploaded = await comfyUIClient.uploadImage(buffer, path.basename(absPath));
        inputImageName = uploaded.name;
      }
      const graph = injectParams(workflowDef, {
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
        seed: request.seed ?? Math.floor(Math.random() * 2147483647),
        width: request.width,
        height: request.height,
        inputImage: inputImageName,
        extraParams: request.extraParams,
      });
      if (request.waitForCompletion === false) {
        return await new Promise<GenerateResult>((resolve, reject) => {
          let resolvedEarly = false;
          void this.runJobWithGpuHandoff(async () => {
            const submitted = await comfyUIClient.submitPrompt(graph, clientId);
            promptIdRef.value = submitted.prompt_id;
            const initial: GenerateResult = { promptId: submitted.prompt_id, status: 'running', outputs: [] };
            this.jobs.set(submitted.prompt_id, initial);
            resolvedEarly = true;
            resolve(initial);
            return await this.runCompletion(submitted.prompt_id, workflowDef, clientId);
          }).catch((err: Error) => {
            const promptId = promptIdRef.value;
            if (promptId) {
              this.jobs.set(promptId, { promptId, status: 'failed', outputs: [], error: err.message });
            }
            if (!resolvedEarly) {
              reject(err);
            }
          }).finally(() => {
            doRelease();
          });
        });
      }
      return await this.runJobWithGpuHandoff(async () => {
        const { promptId, history } = await comfyUIClient.submitPromptAndWait(graph, {
          clientId,
          timeoutMs: configManager.getConfig().comfyui.requestTimeoutMs,
          onProgress: (message) => console.log(`[ComfyUI] ${message}`),
        });
        promptIdRef.value = promptId;
        this.jobs.set(promptId, { promptId, status: 'queued', outputs: [] });
        return await this.runCompletion(promptId, workflowDef, clientId, history);
      });
    } catch (err: any) {
      const promptId = promptIdRef.value ?? randomUUID();
      const failed: GenerateResult = { promptId, status: 'failed', outputs: [], error: err.message };
      this.jobs.set(promptId, failed);
      throw err;
    } finally {
      if (request.waitForCompletion !== false) {
        doRelease();
      }
    }
  }

  private async runCompletion(
    promptId: string,
    workflowDef: WorkflowDefinition,
    clientId: string,
    history?: Awaited<ReturnType<typeof comfyUIClient.getHistory>>,
  ): Promise<GenerateResult> {
    this.jobs.set(promptId, { promptId, status: 'running', outputs: [] });
    try {
      const resolvedHistory =
        history ??
        (await comfyUIClient.waitForCompletion(promptId, {
          clientId,
          timeoutMs: configManager.getConfig().comfyui.requestTimeoutMs,
        }));
      const outputs = await this.downloadOutputs(promptId, resolvedHistory, workflowDef.type);
      const result: GenerateResult = { promptId, status: 'completed', outputs };
      this.jobs.set(promptId, result);
      return result;
    } catch (err: any) {
      const failed: GenerateResult = { promptId, status: 'failed', outputs: [], error: err.message };
      this.jobs.set(promptId, failed);
      throw err;
    }
  }

  private async downloadOutputs(
    promptId: string,
    history: { outputs?: Record<string, { images?: ComfyUIHistoryOutput[]; gifs?: ComfyUIHistoryOutput[]; videos?: ComfyUIHistoryOutput[] }> },
    workflowType: 'image' | 'video',
  ): Promise<GenerateOutput[]> {
    const outputDir = path.join(this.resolveOutputDir(), promptId);
    await fs.mkdir(outputDir, { recursive: true });
    const files = collectHistoryOutputs(history);
    if (files.length === 0) {
      throw new Error('ComfyUI completed but produced no output files');
    }
    const results: GenerateOutput[] = [];
    for (const file of files) {
      const buffer = await comfyUIClient.downloadOutput(file.filename, file.subfolder ?? '', file.type ?? 'output');
      const safeName = path.basename(file.filename);
      const localPath = path.join(outputDir, safeName);
      await fs.writeFile(localPath, buffer);
      let relPath = path.relative(process.cwd(), localPath).replace(/\\/g, '/');
      const runCtx = getAgentRunContext();
      if (runCtx?.orgTaskId) {
        try {
          relPath = await copyFileIntoTaskArtifacts(
            toTaskArtifactScope(runCtx),
            localPath,
            `images/${safeName}`,
          );
        } catch (copyErr: unknown) {
          const msg = copyErr instanceof Error ? copyErr.message : String(copyErr);
          console.warn(`[ComfyUI] Could not copy output to task artifacts: ${msg}`);
        }
      }
      const isVideo = workflowType === 'video' || isVideoFilename(safeName);
      const urlPath = relPath.startsWith('workspace/')
        ? `/workspace/download/${relPath.slice('workspace/'.length)}`
        : `/comfyui/outputs/${encodeURIComponent(promptId)}/${encodeURIComponent(safeName)}`;
      results.push({
        filename: safeName,
        localPath: relPath,
        url: urlPath,
        type: isVideo ? 'video' : 'image',
      });
    }
    return results;
  }

  resolveOutputFilePath(promptId: string, filename: string): string | null {
    const safePromptId = path.basename(promptId);
    const safeFilename = path.basename(filename);
    const filePath = path.join(this.resolveOutputDir(), safePromptId, safeFilename);
    const outputRoot = path.resolve(this.resolveOutputDir());
    if (!path.resolve(filePath).startsWith(outputRoot + path.sep)) return null;
    return filePath;
  }
}

export const comfyUIService = new ComfyUIService();
