import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';

export interface ChatThread {
  id: string;
  title: string;
  updatedAt: number;
  messages: { role: string; content: string }[];
}

export class AgentHistoryManager {
  private chatsDir: string;
  private activeThreads: Record<string, BaseMessage[]> = {};

  constructor() {
    this.chatsDir = path.join(process.cwd(), 'workspace', 'chats');
    if (!fsSync.existsSync(this.chatsDir)) {
      fsSync.mkdirSync(this.chatsDir, { recursive: true });
    }
    this.recoverTempFiles().catch((e: any) => {
      console.warn(`[History] Recovery scan failed: ${e.message}`);
    });
  }

  private async recoverTempFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.chatsDir);
      for (const file of files) {
        if (!file.endsWith('.tmp')) continue;
        const fullPath = path.join(this.chatsDir, file);
        const finalPath = fullPath.slice(0, -4);
        try {
          const text = await fs.readFile(fullPath, 'utf-8');
          JSON.parse(text);
          await fs.rename(fullPath, finalPath);
          console.log(`[History] Recovered temp chat file: ${path.basename(finalPath)}`);
        } catch {
          await fs.unlink(fullPath).catch(() => {});
        }
      }
    } catch {
      // non-critical
    }
  }

  private async writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
    const tempPath = `${targetPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf-8');
    await fs.rename(tempPath, targetPath);
  }

  async listChats(): Promise<{ id: string; title: string; updatedAt: number }[]> {
    try {
      const files = await fs.readdir(this.chatsDir);
      const list = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = JSON.parse(await fs.readFile(path.join(this.chatsDir, file), 'utf-8'));
          list.push({ id: data.id, title: data.title, updatedAt: data.updatedAt });
        } catch {
          // Skip malformed files instead of crashing list operation.
        }
      }
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  async loadChat(chatId: string): Promise<BaseMessage[]> {
    if (this.activeThreads[chatId]) return this.activeThreads[chatId];
    
    try {
      const p = path.join(this.chatsDir, `${chatId}.json`);
      if (fsSync.existsSync(p)) {
        const text = await fs.readFile(p, 'utf-8');
        const raw = JSON.parse(text) as ChatThread;
        const msgs: BaseMessage[] = [];
        for (const m of raw.messages) {
          if (m.role === 'user') msgs.push(new HumanMessage({ content: m.content }));
          if (m.role === 'ai') msgs.push(new AIMessage({ content: m.content }));
          if (m.role === 'system') msgs.push(new SystemMessage({ content: m.content }));
        }
        this.activeThreads[chatId] = msgs;
        return msgs;
      }
    } catch (e: any) {
      console.warn(`[History] Failed to load chat ${chatId}: ${e.message}`);
    }
    this.activeThreads[chatId] = [];
    return this.activeThreads[chatId];
  }

  async saveChat(chatId: string, title?: string): Promise<void> {
    const thread = this.activeThreads[chatId];
    if (!thread) return;

    if (!title) {
        // Auto-generate title from first user message if available
        const firstUser = thread.find(m => m.getType() === 'human');
        title = firstUser ? (firstUser.content as string).substring(0, 40) + '...' : 'New Chat';
    }

    const doc: ChatThread = {
      id: chatId,
      title,
      updatedAt: Date.now(),
      messages: thread.map(m => ({
        role: m.getType() === 'human' ? 'user' : m.getType() === 'system' ? 'system' : 'ai',
        content: m.content.toString()
      }))
    };

    try {
      await this.writeJsonAtomic(path.join(this.chatsDir, `${chatId}.json`), doc);
    } catch (e: any) {
      console.warn(`[History] Failed to save chat ${chatId}: ${e.message}`);
    }
  }

  getThread(chatId: string): BaseMessage[] {
    if (!this.activeThreads[chatId]) {
      this.activeThreads[chatId] = [];
    }
    return this.activeThreads[chatId];
  }

  setThread(chatId: string, msgs: BaseMessage[]) {
    this.activeThreads[chatId] = msgs;
  }

  async deleteChat(chatId: string): Promise<boolean> {
    delete this.activeThreads[chatId];
    try {
      const p = path.join(this.chatsDir, `${chatId}.json`);
      if (fsSync.existsSync(p)) {
        await fs.unlink(p);
      }
      return true;
    } catch {
      return false;
    }
  }

  async getHistoryLength(chatId: string): Promise<number> {
    const thread = await this.loadChat(chatId);
    return Math.floor(thread.length / 2);
  }
}

export const historyManager = new AgentHistoryManager();
