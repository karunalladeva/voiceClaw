import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { configManager } from '../../config/index';
import type { ChatSessionRecord } from '../contracts/run-context';
import { buildChatScopeId, scopeStoreDir } from './scope-id';

const SESSION_INDEX = 'sessions.json';

function sessionsIndexPath(): string {
  return path.join(process.cwd(), 'workspace', 'session-store', SESSION_INDEX);
}

function generateId(): string {
  return crypto.randomUUID();
}

export class SessionRuntime {
  private sessions = new Map<string, ChatSessionRecord>();
  private chatToSession = new Map<string, string>();
  private loaded = false;

  async initialize(): Promise<void> {
    await this.loadIndex();
    await this.runCleanup();
  }

  private async loadIndex(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(sessionsIndexPath(), 'utf-8');
      const list = JSON.parse(raw) as ChatSessionRecord[];
      for (const row of list) {
        this.sessions.set(row.sessionId, row);
        this.chatToSession.set(row.chatId, row.sessionId);
      }
    } catch {
      // first boot
    }
    this.loaded = true;
  }

  private async persistIndex(): Promise<void> {
    const dir = path.dirname(sessionsIndexPath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(sessionsIndexPath(), JSON.stringify([...this.sessions.values()], null, 2), 'utf-8');
  }

  async createChatSession(chatId?: string): Promise<ChatSessionRecord> {
    await this.loadIndex();
    const id = chatId?.trim() || generateId();
    const existing = this.chatToSession.get(id);
    if (existing) {
      const row = this.sessions.get(existing);
      if (row) {
        row.lastActiveAt = new Date().toISOString();
        await this.persistIndex();
        return row;
      }
    }
    const sessionId = generateId();
    const record: ChatSessionRecord = {
      sessionId,
      chatId: id,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, record);
    this.chatToSession.set(id, sessionId);
    await fs.mkdir(path.join(process.cwd(), 'workspace', 'session-store', scopeStoreDir(buildChatScopeId(id))), { recursive: true }).catch(() => {});
    await this.persistIndex();
    return record;
  }

  async resolveSession(sessionId: string): Promise<ChatSessionRecord | null> {
    await this.loadIndex();
    const row = this.sessions.get(sessionId.trim());
    if (!row) return null;
    row.lastActiveAt = new Date().toISOString();
    await this.persistIndex();
    return row;
  }

  getScopeForSession(session: ChatSessionRecord): string {
    return buildChatScopeId(session.chatId);
  }

  async runCleanup(): Promise<number> {
    const ttlDays = configManager.getConfig().agent?.context?.sessionStoreTtlDays ?? 30;
    const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [sessionId, row] of this.sessions.entries()) {
      const last = Date.parse(row.lastActiveAt);
      if (Number.isNaN(last) || last >= cutoff) continue;
      this.sessions.delete(sessionId);
      this.chatToSession.delete(row.chatId);
      removed += 1;
    }
    if (removed > 0) await this.persistIndex();
    return removed;
  }
}

export const sessionRuntime = new SessionRuntime();
