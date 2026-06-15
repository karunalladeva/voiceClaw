import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { configManager } from '../../config/index';
import type {
  HandoffPointer,
  RegisterPayloadMeta,
  UpstreamPointerRegistry,
} from '../contracts';
import { UPSTREAM_REGISTRY_FILENAME } from '../contracts';
import { scopeStoreDir } from '../session/scope-id';

const MAX_PAYLOAD_BYTES = 50 * 1024 * 1024;

export class PointerScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PointerScopeError';
  }
}

function workspaceRoot(): string {
  return path.join(process.cwd(), 'workspace', 'session-store');
}

function scopeRoot(scopeId: string): string {
  return path.join(workspaceRoot(), scopeStoreDir(scopeId));
}

function safeRelPath(relPath: string): string {
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  if (normalized.includes('..')) throw new PointerScopeError('Invalid relative path');
  return normalized;
}

export class SessionContextService {
  private readCounts = new Map<string, { count: number; resetAt: number }>();

  private checkReadRate(scopeId: string): void {
    const limit = configManager.getConfig().agent?.context?.readPointerRatePerMin ?? 20;
    const now = Date.now();
    const key = scopeId;
    const row = this.readCounts.get(key);
    if (!row || now > row.resetAt) {
      this.readCounts.set(key, { count: 1, resetAt: now + 60_000 });
      return;
    }
    row.count += 1;
    if (row.count > limit) throw new PointerScopeError('read_pointer rate limit exceeded');
  }

  async registerPayload(
    scopeId: string,
    bytes: Buffer | string,
    meta: RegisterPayloadMeta,
  ): Promise<HandoffPointer> {
    const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf-8') : bytes;
    if (buf.byteLength > MAX_PAYLOAD_BYTES) {
      throw new PointerScopeError(`Payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
    }
    const id = crypto.randomUUID();
    const relPath = safeRelPath(`payloads/${id}.raw`);
    const root = scopeRoot(scopeId);
    await fs.mkdir(root, { recursive: true });
    const abs = path.join(root, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const summary = (meta.summary ?? buf.toString('utf-8').slice(0, 2000)).slice(0, 2000);
    const pointer: HandoffPointer = {
      schemaVersion: 1,
      id,
      scopeId,
      kind: meta.kind,
      toolName: meta.toolName,
      skillId: meta.skillId,
      title: meta.title.slice(0, 120),
      summary,
      byteSize: buf.byteLength,
      sha256,
      relPath,
      createdAt: new Date().toISOString(),
    };
    const pointerMetaPath = path.join(root, 'pointers', `${id}.json`);
    await fs.mkdir(path.dirname(pointerMetaPath), { recursive: true });
    await fs.writeFile(pointerMetaPath, JSON.stringify(pointer, null, 2), 'utf-8');
    return pointer;
  }

  async resolvePointer(
    scopeId: string,
    pointerId: string,
    opts?: { maxBytes?: number; audit?: (msg: string) => void },
  ): Promise<string> {
    this.checkReadRate(scopeId);
    const root = scopeRoot(scopeId);
    const metaPath = path.join(root, 'pointers', `${pointerId}.json`);
    const rawMeta = await fs.readFile(metaPath, 'utf-8');
    const pointer = JSON.parse(rawMeta) as HandoffPointer;
    if (pointer.scopeId !== scopeId) throw new PointerScopeError('Pointer scope mismatch');
    const abs = path.join(root, safeRelPath(pointer.relPath));
    if (!abs.startsWith(root)) throw new PointerScopeError('Path traversal denied');
    const maxBytes = opts?.maxBytes ?? MAX_PAYLOAD_BYTES;
    const content = await fs.readFile(abs);
    if (content.byteLength > maxBytes) {
      return content.subarray(0, maxBytes).toString('utf-8') + '\n...[truncated at read cap]';
    }
    opts?.audit?.(`read_pointer ${pointerId} scope=${scopeId}`);
    return content.toString('utf-8');
  }

  private orgRootFromScope(scopeId: string): string | null {
    if (!scopeId.startsWith('org:')) return null;
    const rest = scopeId.slice(4);
    const colon = rest.indexOf(':');
    if (colon <= 0) return null;
    return rest.slice(0, colon);
  }

  /** Search sibling org task scopes under the same pipeline root for a pointer id. */
  async findPointerScopeInOrg(scopeId: string, pointerId: string): Promise<string | null> {
    const rootTaskId = this.orgRootFromScope(scopeId);
    if (!rootTaskId) return null;
    const prefix = `org_${rootTaskId}_`;
    const storeRoot = workspaceRoot();
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(storeRoot, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
      const metaPath = path.join(storeRoot, entry.name, 'pointers', `${pointerId}.json`);
      try {
        await fs.access(metaPath);
        const raw = await fs.readFile(metaPath, 'utf-8');
        const pointer = JSON.parse(raw) as HandoffPointer;
        return pointer.scopeId;
      } catch {
        continue;
      }
    }
    return null;
  }

  async resolvePointerFlexible(
    scopeId: string,
    pointerId: string,
    opts?: { maxBytes?: number; audit?: (msg: string) => void },
  ): Promise<string> {
    try {
      return await this.resolvePointer(scopeId, pointerId, opts);
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as NodeJS.ErrnoException).code)
          : '';
      if (!(err instanceof PointerScopeError) && code !== 'ENOENT') {
        throw err;
      }
    }
    const siblingScope = await this.findPointerScopeInOrg(scopeId, pointerId);
    if (siblingScope && siblingScope !== scopeId) {
      return this.resolvePointer(siblingScope, pointerId, opts);
    }
    throw new PointerScopeError(
      `Pointer "${pointerId}" not found in this task scope. ` +
        `Use pointer UUIDs from pointer:… lines in your context, or read_file on upstream artifact paths.`,
    );
  }

  async registerMapSummary(scopeId: string, pointerId: string, summary: string): Promise<void> {
    const root = scopeRoot(scopeId);
    const rel = safeRelPath(`pointers/${pointerId}.summary.md`);
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), summary.slice(0, 8000), 'utf-8');
  }

  async loadUpstreamRegistry(scopeId: string, taskId: string): Promise<UpstreamPointerRegistry | null> {
    try {
      const root = scopeRoot(scopeId);
      const p = path.join(root, UPSTREAM_REGISTRY_FILENAME);
      const raw = await fs.readFile(p, 'utf-8');
      return JSON.parse(raw) as UpstreamPointerRegistry;
    } catch {
      return null;
    }
  }

  async saveUpstreamRegistry(scopeId: string, registry: UpstreamPointerRegistry): Promise<void> {
    const root = scopeRoot(scopeId);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, UPSTREAM_REGISTRY_FILENAME), JSON.stringify(registry, null, 2), 'utf-8');
  }

  async buildMemoryState(scopeId: string): Promise<string> {
    try {
      const root = scopeRoot(scopeId);
      const p = path.join(root, 'memory-state.txt');
      return (await fs.readFile(p, 'utf-8')).trim();
    } catch {
      return '';
    }
  }

  async saveMemoryState(scopeId: string, paragraph: string): Promise<void> {
    const root = scopeRoot(scopeId);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'memory-state.txt'), paragraph.slice(0, 4000), 'utf-8');
  }

  async promoteToAce(scopeId: string): Promise<string> {
    if (!configManager.getConfig().agent?.context?.ace?.enabled) {
      throw new Error('ACE is disabled');
    }
    const root = scopeRoot(scopeId);
    const aceDir = path.join(process.cwd(), 'workspace', 'ace-playbook', scopeStoreDir(scopeId));
    await fs.mkdir(aceDir, { recursive: true });
    await fs.cp(root, aceDir, { recursive: true, force: true });
    return aceDir;
  }
}

export const sessionContextService = new SessionContextService();
