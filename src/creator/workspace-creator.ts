import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { generateCreatorContent, regenerateCreatorContent } from './creator-llm';

export type CreatorItemType = 'skill' | 'mcp' | 'template';
export type CreatorItemStatus = 'draft' | 'approved' | 'disabled';

export interface CreatorGenerateRequest {
  name: string;
  purpose: string;
  prompt: string;
  generate: {
    skill?: boolean;
    mcp?: boolean;
    template?: boolean;
  };
}

export interface CreatorItemMeta {
  id: string;
  name: string;
  slug: string;
  type: CreatorItemType;
  purpose: string;
  status: CreatorItemStatus;
  source: 'generator' | 'manual';
  version: number;
  createdAt: string;
  updatedAt: string;
  lastEditedAt?: string;
  notes?: string;
}

export interface CreatorItemSummary extends CreatorItemMeta {
  relativeDir: string;
}

export interface CreatorItemDetail {
  meta: CreatorItemMeta;
  content: Record<string, string>;
}

const WORKSPACE_ROOT = path.join(process.cwd(), 'workspace');
const CREATOR_ROOTS: Record<CreatorItemType, string> = {
  skill: path.join(WORKSPACE_ROOT, 'skills'),
  mcp: path.join(WORKSPACE_ROOT, 'mcp'),
  template: path.join(WORKSPACE_ROOT, 'templates'),
};

const PURPOSE_PRESETS = ['trading', 'mail', 'ops', 'research'];

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64);
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizePurpose(raw: string): string {
  const normalized = slugify(raw);
  if (!normalized) {
    throw new Error('purpose required');
  }
  return normalized;
}

function assertSafeName(name: string, fieldName: string): string {
  const slug = slugify(name);
  if (!slug) {
    throw new Error(`${fieldName} required`);
  }
  if (slug.includes('..') || path.isAbsolute(slug)) {
    throw new Error(`${fieldName} invalid`);
  }
  return slug;
}

function getItemDir(type: CreatorItemType, slug: string): string {
  const root = CREATOR_ROOTS[type];
  return path.join(root, slug);
}

function getMetaPath(type: CreatorItemType, slug: string): string {
  return path.join(getItemDir(type, slug), 'meta.json');
}

function getContentPath(type: CreatorItemType, slug: string): string {
  if (type === 'skill') return path.join(getItemDir(type, slug), 'SKILL.md');
  if (type === 'mcp') return path.join(getItemDir(type, slug), 'mcp.json');
  return path.join(getItemDir(type, slug), 'template.json');
}

function ensureInsideWorkspace(targetPath: string): void {
  const normalizedWorkspace = path.resolve(WORKSPACE_ROOT);
  const normalizedTarget = path.resolve(targetPath);
  if (!normalizedTarget.startsWith(normalizedWorkspace + path.sep) && normalizedTarget !== normalizedWorkspace) {
    throw new Error('path escapes workspace');
  }
}

function appendNote(existing: string | undefined, nextLine: string): string {
  if (!existing || !existing.trim()) return nextLine;
  return `${existing}\n${nextLine}`;
}

async function readMeta(type: CreatorItemType, slug: string): Promise<CreatorItemMeta | null> {
  try {
    const raw = await fs.readFile(getMetaPath(type, slug), 'utf-8');
    return JSON.parse(raw) as CreatorItemMeta;
  } catch {
    return null;
  }
}

async function writeMeta(type: CreatorItemType, slug: string, meta: CreatorItemMeta): Promise<void> {
  const metaPath = getMetaPath(type, slug);
  ensureInsideWorkspace(metaPath);
  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

async function writeContent(type: CreatorItemType, slug: string, content: string): Promise<void> {
  const contentPath = getContentPath(type, slug);
  ensureInsideWorkspace(contentPath);
  await fs.mkdir(path.dirname(contentPath), { recursive: true });
  await fs.writeFile(contentPath, content, 'utf-8');
}

async function readContent(type: CreatorItemType, slug: string): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  const contentPath = getContentPath(type, slug);
  try {
    output[path.basename(contentPath)] = await fs.readFile(contentPath, 'utf-8');
  } catch {
    output[path.basename(contentPath)] = '';
  }
  return output;
}

export async function ensureCreatorDirectories(): Promise<void> {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  await Promise.all(Object.values(CREATOR_ROOTS).map((dir) => fs.mkdir(dir, { recursive: true })));
}

export async function listCreatorItems(
  type?: CreatorItemType,
  purpose?: string,
  status?: CreatorItemStatus,
): Promise<CreatorItemSummary[]> {
  await ensureCreatorDirectories();
  const types: CreatorItemType[] = type ? [type] : ['skill', 'mcp', 'template'];
  const normalizedPurpose = purpose ? sanitizePurpose(purpose) : '';
  const results: CreatorItemSummary[] = [];
  for (const t of types) {
    const root = CREATOR_ROOTS[t];
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const slug = entry.name;
      const meta = await readMeta(t, slug);
      if (!meta) continue;
      if (normalizedPurpose && meta.purpose !== normalizedPurpose) continue;
      if (status && meta.status !== status) continue;
      results.push({
        ...meta,
        relativeDir: path.relative(process.cwd(), getItemDir(t, slug)).replace(/\\/g, '/'),
      });
    }
  }
  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return results;
}

export async function getCreatorItem(type: CreatorItemType, slugOrName: string): Promise<CreatorItemDetail | null> {
  const slug = assertSafeName(slugOrName, 'name');
  const meta = await readMeta(type, slug);
  if (!meta) return null;
  const content = await readContent(type, slug);
  return { meta, content };
}

export async function checkCreatorConflicts(
  type: CreatorItemType,
  name: string,
  purpose: string,
): Promise<{ exact: boolean; similar: Array<{ slug: string; name: string }> }> {
  const slug = assertSafeName(name, 'name');
  const normalizedPurpose = sanitizePurpose(purpose);
  const all = await listCreatorItems(type);
  const exact = all.some((item) => item.slug === slug && item.purpose === normalizedPurpose);
  const similar = all
    .filter((item) => item.slug !== slug && (item.slug.includes(slug) || slug.includes(item.slug)))
    .slice(0, 5)
    .map((item) => ({ slug: item.slug, name: item.name }));
  return { exact, similar };
}

async function createOne(
  type: CreatorItemType,
  input: { name: string; purpose: string; prompt: string },
): Promise<CreatorItemMeta> {
  const slug = assertSafeName(input.name, 'name');
  const purpose = sanitizePurpose(input.purpose);
  const existing = await readMeta(type, slug);
  if (existing && existing.purpose === purpose) {
    throw new Error(`${type} already exists for this purpose`);
  }
  const timestamp = nowIso();
  const generated = await generateCreatorContent({
    type,
    name: input.name.trim(),
    purpose,
    prompt: input.prompt,
  });
  const auditLine = `[${timestamp}] Generated via ${generated.modelId} prompt="${input.prompt || ''}"`;
  const meta: CreatorItemMeta = {
    id: `${type}-${slug}-${Date.now()}`,
    name: input.name.trim(),
    slug,
    type,
    purpose,
    status: 'draft',
    source: 'generator',
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    notes: auditLine,
  };
  await writeMeta(type, slug, meta);
  await writeContent(type, slug, generated.content);
  return meta;
}

export async function generateCreatorItems(input: CreatorGenerateRequest): Promise<CreatorItemMeta[]> {
  await ensureCreatorDirectories();
  const name = input.name?.trim();
  const prompt = String(input.prompt || '').trim();
  if (!name) throw new Error('name required');
  sanitizePurpose(input.purpose);
  const selectedTypes: CreatorItemType[] = [];
  if (input.generate.skill) selectedTypes.push('skill');
  if (input.generate.mcp) selectedTypes.push('mcp');
  if (input.generate.template) selectedTypes.push('template');
  if (selectedTypes.length === 0) throw new Error('at least one generate target required');
  const created: CreatorItemMeta[] = [];
  for (const type of selectedTypes) {
    const meta = await createOne(type, { name, purpose: input.purpose, prompt });
    created.push(meta);
  }
  return created;
}

export async function updateCreatorItem(
  type: CreatorItemType,
  slugOrName: string,
  updates: { name?: string; purpose?: string; notes?: string; content?: string },
): Promise<CreatorItemDetail | null> {
  const slug = assertSafeName(slugOrName, 'name');
  const existing = await readMeta(type, slug);
  if (!existing) return null;
  const now = nowIso();
  const updated: CreatorItemMeta = {
    ...existing,
    name: updates.name?.trim() || existing.name,
    purpose: updates.purpose ? sanitizePurpose(updates.purpose) : existing.purpose,
    notes: updates.notes ?? existing.notes,
    updatedAt: now,
    lastEditedAt: now,
    version: existing.version + 1,
    status: existing.status === 'approved' ? 'draft' : existing.status,
  };
  await writeMeta(type, slug, updated);
  if (typeof updates.content === 'string') {
    await writeContent(type, slug, updates.content);
  }
  const content = await readContent(type, slug);
  return { meta: updated, content };
}

export async function regenerateCreatorItem(
  type: CreatorItemType,
  slugOrName: string,
  prompt: string,
): Promise<CreatorItemDetail | null> {
  const slug = assertSafeName(slugOrName, 'name');
  const existing = await readMeta(type, slug);
  if (!existing) return null;
  const current = await readContent(type, slug);
  const currentContent = Object.values(current)[0] || '';
  const regenerated = await regenerateCreatorContent({
    type,
    name: existing.name,
    purpose: existing.purpose,
    prompt,
    currentContent,
  });
  const noteLine = `[${nowIso()}] Regenerated via ${regenerated.modelId} prompt="${prompt}"`;
  const updated = await updateCreatorItem(type, slug, {
    content: regenerated.content,
    notes: appendNote(existing.notes, noteLine),
  });
  return updated;
}

export async function setCreatorItemStatus(
  type: CreatorItemType,
  slugOrName: string,
  status: CreatorItemStatus,
): Promise<CreatorItemMeta | null> {
  const slug = assertSafeName(slugOrName, 'name');
  const existing = await readMeta(type, slug);
  if (!existing) return null;
  const updated: CreatorItemMeta = {
    ...existing,
    status,
    updatedAt: nowIso(),
  };
  await writeMeta(type, slug, updated);
  return updated;
}

export async function deleteCreatorItem(type: CreatorItemType, slugOrName: string): Promise<boolean> {
  const slug = assertSafeName(slugOrName, 'name');
  const dir = getItemDir(type, slug);
  ensureInsideWorkspace(dir);
  if (!fsSync.existsSync(dir)) return false;
  await fs.rm(dir, { recursive: true, force: true });
  return true;
}

export function getPurposePresets(): string[] {
  return [...PURPOSE_PRESETS];
}

export async function loadApprovedWorkspaceTemplates(purpose?: string): Promise<Array<{ id: string; name: string; category: string; description?: string; steps: any[] }>> {
  const items = await listCreatorItems('template', purpose ? sanitizePurpose(purpose) : undefined, 'approved');
  const templates: Array<{ id: string; name: string; category: string; description?: string; steps: any[] }> = [];
  for (const item of items) {
    try {
      const raw = await fs.readFile(getContentPath('template', item.slug), 'utf-8');
      const parsed = JSON.parse(raw) as { id?: string; name?: string; category?: string; description?: string; steps?: any[] };
      if (!Array.isArray(parsed.steps)) continue;
      templates.push({
        id: `creator-${item.slug}`,
        name: parsed.name || item.name,
        category: parsed.category || item.purpose,
        description: parsed.description,
        steps: parsed.steps,
      });
    } catch {
      continue;
    }
  }
  return templates;
}

export async function loadApprovedWorkspaceSkills(purpose?: string): Promise<Array<{ id: string; name: string; category: string; description: string; enabled: boolean; tags: string[] }>> {
  const items = await listCreatorItems('skill', purpose ? sanitizePurpose(purpose) : undefined, 'approved');
  return items.map((item) => ({
    id: `creator-${item.slug}`,
    name: item.name,
    category: item.purpose,
    description: item.notes || `Workspace generated ${item.purpose} skill`,
    enabled: true,
    tags: ['workspace', item.purpose],
  }));
}
