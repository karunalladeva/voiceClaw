import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import type { Message } from '../runtime/messages';
import {
  assistantMessage,
  messageContentToString,
  systemMessage,
  userMessage,
} from '../runtime/messages';
import {
  getHistoryContextConfig,
  selectHistoryIndices,
  type HistoryCandidate,
} from '../services/history-context-ranker';
import { removeSpokenSummaryBlock } from '../utils/speech-for-tts';

function messageContentForDisplay(role: string, content: string): string {
  return role === 'ai' ? removeSpokenSummaryBlock(content) : content;
}

function recordRoleFromMessage(msg: Message): 'user' | 'ai' | 'system' {
  if (msg.role === 'user') return 'user';
  if (msg.role === 'system') return 'system';
  return 'ai';
}

export interface ChatSummaryRecord {
  id: string;
  content: string;
  createdAt: number;
  summarizedMessageCount: number;
}

export interface ChatMessageRecord {
  role: 'user' | 'ai' | 'system';
  content: string;
  isSummarized?: boolean;
}

export interface ChatThread {
  id: string;
  title: string;
  updatedAt: number;
  summaries?: ChatSummaryRecord[];
  messages: ChatMessageRecord[];
}

interface ThreadMeta {
  isSummarized: boolean[];
  summaries: ChatSummaryRecord[];
}

const LEGACY_SUMMARY_PREFIX = '[Conversation Summary]:';

function isLegacySummaryContent(content: string): boolean {
  return content.startsWith(LEGACY_SUMMARY_PREFIX);
}

function extractLegacySummaryBody(content: string): string {
  return content
    .replace(/^\[Conversation Summary\]:\\n/, '')
    .replace(/^\[Conversation Summary\]:\n/, '')
    .replace(/^\[Conversation Summary\]:/, '')
    .trim();
}

function newSummaryId(): string {
  return `sum_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class AgentHistoryManager {
  private chatsDir: string;
  private activeThreads: Record<string, Message[]> = {};
  private threadMeta: Record<string, ThreadMeta> = {};

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

  private ensureMeta(chatId: string, threadLength: number): ThreadMeta {
    if (!this.threadMeta[chatId]) {
      this.threadMeta[chatId] = { isSummarized: [], summaries: [] };
    }
    const meta = this.threadMeta[chatId];
    while (meta.isSummarized.length < threadLength) {
      meta.isSummarized.push(false);
    }
    return meta;
  }

  private normalizeLoadedThread(raw: ChatThread): ChatThread {
    const summaries: ChatSummaryRecord[] = [...(raw.summaries ?? [])];
    const messages: ChatMessageRecord[] = [];
    for (const m of raw.messages) {
      if (m.role === 'system' && isLegacySummaryContent(m.content)) {
        summaries.push({
          id: newSummaryId(),
          content: extractLegacySummaryBody(m.content),
          createdAt: raw.updatedAt,
          summarizedMessageCount: 0,
        });
        continue;
      }
      messages.push({
        role: m.role,
        content: m.content,
        isSummarized: m.isSummarized ?? false,
      });
    }
    return { ...raw, summaries, messages };
  }

  private applyThreadFromDoc(chatId: string, doc: ChatThread): Message[] {
    const msgs: Message[] = [];
    for (const m of doc.messages) {
      if (m.role === 'user') msgs.push(userMessage(m.content));
      if (m.role === 'ai') msgs.push(assistantMessage(m.content));
      if (m.role === 'system') msgs.push(systemMessage(m.content));
    }
    this.activeThreads[chatId] = msgs;
    this.threadMeta[chatId] = {
      isSummarized: doc.messages.map((m) => m.isSummarized ?? false),
      summaries: doc.summaries ?? [],
    };
    return msgs;
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
          // Skip malformed files
        }
      }
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  async loadChat(chatId: string): Promise<Message[]> {
    if (this.activeThreads[chatId]) return this.activeThreads[chatId];
    try {
      const p = path.join(this.chatsDir, `${chatId}.json`);
      if (fsSync.existsSync(p)) {
        const text = await fs.readFile(p, 'utf-8');
        const raw = JSON.parse(text) as ChatThread;
        const doc = this.normalizeLoadedThread(raw);
        return this.applyThreadFromDoc(chatId, doc);
      }
    } catch (e: any) {
      console.warn(`[History] Failed to load chat ${chatId}: ${e.message}`);
    }
    this.activeThreads[chatId] = [];
    this.threadMeta[chatId] = { isSummarized: [], summaries: [] };
    return this.activeThreads[chatId];
  }

  exportChatDoc(chatId: string): ChatThread | null {
    const thread = this.activeThreads[chatId];
    if (!thread) return null;
    const meta = this.threadMeta[chatId] ?? { isSummarized: [], summaries: [] };
    this.ensureMeta(chatId, thread.length);
    return {
      id: chatId,
      title: 'Chat',
      updatedAt: Date.now(),
      summaries: meta.summaries,
      messages: thread.map((m, i) => {
        const role = recordRoleFromMessage(m);
        return {
          role,
          content: messageContentForDisplay(role, messageContentToString(m.content)),
          isSummarized: meta.isSummarized[i] ?? false,
        };
      }),
    };
  }

  async saveChat(chatId: string, title?: string): Promise<void> {
    const thread = this.activeThreads[chatId];
    if (!thread) return;
    const meta = this.ensureMeta(chatId, thread.length);
    if (!title) {
      const firstUser = thread.find((m) => m.role === 'user');
      title = firstUser
        ? `${messageContentToString(firstUser.content).substring(0, 40)}...`
        : 'New Chat';
    }
    const doc: ChatThread = {
      id: chatId,
      title,
      updatedAt: Date.now(),
      summaries: meta.summaries,
      messages: thread.map((m, i) => {
        const role = recordRoleFromMessage(m);
        return {
          role,
          content: messageContentForDisplay(role, messageContentToString(m.content)),
          isSummarized: meta.isSummarized[i] ?? false,
        };
      }),
    };
    try {
      await this.writeJsonAtomic(path.join(this.chatsDir, `${chatId}.json`), doc);
    } catch (e: any) {
      console.warn(`[History] Failed to save chat ${chatId}: ${e.message}`);
    }
  }

  getThread(chatId: string): Message[] {
    if (!this.activeThreads[chatId]) {
      this.activeThreads[chatId] = [];
      this.threadMeta[chatId] = { isSummarized: [], summaries: [] };
    }
    return this.activeThreads[chatId];
  }

  setThread(chatId: string, msgs: Message[]) {
    this.activeThreads[chatId] = msgs;
    this.ensureMeta(chatId, msgs.length);
  }

  appendTurn(chatId: string, humanContent: string, aiContent: string): void {
    const thread = this.getThread(chatId);
    thread.push(userMessage(humanContent));
    thread.push(assistantMessage(aiContent));
    this.syncMessageMeta(chatId);
  }

  syncMessageMeta(chatId: string): void {
    const thread = this.getThread(chatId);
    this.ensureMeta(chatId, thread.length);
  }

  async buildLlmContextMessages(
    chatId: string,
    maxChars: number,
    query = '',
  ): Promise<Message[]> {
    await this.loadChat(chatId);
    const thread = this.getThread(chatId);
    const meta = this.ensureMeta(chatId, thread.length);
    const selected: Message[] = [];
    let used = 0;
    const latest = meta.summaries[meta.summaries.length - 1];
    if (latest?.content?.trim()) {
      const summaryMsg = systemMessage(`${LEGACY_SUMMARY_PREFIX}\n${latest.content}`);
      selected.push(summaryMsg);
      used += messageContentToString(summaryMsg.content).length;
    }
    const messageBudget = maxChars - used;
    if (messageBudget <= 0) return selected;

    const candidates: HistoryCandidate[] = [];
    for (let i = 0; i < thread.length; i++) {
      if (meta.isSummarized[i]) continue;
      const msg = thread[i];
      const content = messageContentToString(msg.content);
      if (msg.role === 'system' && isLegacySummaryContent(content)) {
        continue;
      }
      if (!content) continue;
      candidates.push({ index: i, message: msg, text: content, chars: content.length });
    }

    const { ranking } = getHistoryContextConfig();
    const q = query.trim();
    const useSemantic = ranking !== 'recency' && q.length > 0;
    const totalCandidateChars = candidates.reduce((sum, c) => sum + c.chars, 0);

    if (!useSemantic || totalCandidateChars <= messageBudget) {
      let budgetUsed = 0;
      const recencySelected: Message[] = [];
      for (let i = thread.length - 1; i >= 0; i--) {
        if (meta.isSummarized[i]) continue;
        const msg = thread[i];
        const content = messageContentToString(msg.content);
        if (msg.role === 'system' && isLegacySummaryContent(content)) {
          continue;
        }
        if (!content) continue;
        if (budgetUsed + content.length > messageBudget) break;
        recencySelected.unshift(msg);
        budgetUsed += content.length;
      }
      return [...selected, ...recencySelected];
    }

    const indices = await selectHistoryIndices(candidates, messageBudget, q);
    const rankedMessages = indices
      .sort((a, b) => a - b)
      .map((i) => thread[i]);
    console.log(
      `[History] Semantic context (${ranking}): ${rankedMessages.length}/${candidates.length} turns, query="${q.slice(0, 60)}"`,
    );
    return [...selected, ...rankedMessages];
  }

  async buildPrunedContextMessages(
    chatId: string,
    maxChars: number,
    query = '',
    minRecentTurns = 5,
  ): Promise<Message[]> {
    await this.loadChat(chatId);
    const thread = this.getThread(chatId);
    const pairs = minRecentTurns * 2;
    const tail = thread.slice(-pairs);
    let used = tail.reduce((s, m) => s + messageContentToString(m.content).length, 0);
    if (used <= maxChars) return tail;
    const head = thread.slice(0, Math.max(0, thread.length - pairs));
    if (head.length === 0 || !query.trim()) return tail.slice(-Math.max(2, pairs - 2));
    const candidates: HistoryCandidate[] = head.map((m, i) => ({
      index: i,
      message: m,
      text: messageContentToString(m.content),
      chars: messageContentToString(m.content).length,
    }));
    const budget = Math.max(0, maxChars - used);
    const rankedIdx = await selectHistoryIndices(candidates, budget, query);
    const rankedMessages = rankedIdx.map((idx) => head[idx]).filter(Boolean);
    return [...rankedMessages, ...tail];
  }

  isMessageSummarized(chatId: string, index: number): boolean {
    return this.threadMeta[chatId]?.isSummarized[index] ?? false;
  }

  markIndicesSummarized(chatId: string, indices: number[]): void {
    const thread = this.getThread(chatId);
    const meta = this.ensureMeta(chatId, thread.length);
    for (const i of indices) {
      if (i >= 0 && i < meta.isSummarized.length) {
        meta.isSummarized[i] = true;
      }
    }
  }

  getSummaries(chatId: string): ChatSummaryRecord[] {
    return this.threadMeta[chatId]?.summaries ?? [];
  }

  getLatestSummary(chatId: string): ChatSummaryRecord | null {
    const summaries = this.getSummaries(chatId);
    if (summaries.length === 0) return null;
    return summaries[summaries.length - 1];
  }

  getCombinedSummariesText(chatId: string): string {
    const summaries = this.getSummaries(chatId);
    if (summaries.length === 0) return '';
    return summaries
      .map((s, i) => `Summary ${i + 1} (${new Date(s.createdAt).toISOString()}):\n${s.content}`)
      .join('\n\n');
  }

  appendSummary(chatId: string, content: string, summarizedMessageCount: number): void {
    const meta = this.ensureMeta(chatId, this.getThread(chatId).length);
    meta.summaries.push({
      id: newSummaryId(),
      content: content.trim(),
      createdAt: Date.now(),
      summarizedMessageCount,
    });
  }

  getActiveTurnCount(chatId: string): number {
    const thread = this.activeThreads[chatId] ?? [];
    const meta = this.threadMeta[chatId];
    if (!meta) return Math.floor(thread.length / 2);
    let humanCount = 0;
    for (let i = 0; i < thread.length; i++) {
      if (thread[i].role !== 'user') continue;
      if (!meta.isSummarized[i]) humanCount++;
    }
    return humanCount;
  }

  async deleteChat(chatId: string): Promise<boolean> {
    delete this.activeThreads[chatId];
    delete this.threadMeta[chatId];
    try {
      const p = path.join(this.chatsDir, `${chatId}.json`);
      if (fsSync.existsSync(p)) {
        await fs.unlink(p);
      }
      await fs.unlink(`${p}.tmp`).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  async clearAllChats(): Promise<number> {
    let deleted = 0;
    try {
      const files = await fs.readdir(this.chatsDir);
      for (const file of files) {
        if (!file.endsWith('.json') && !file.endsWith('.json.tmp')) continue;
        const chatId = file.replace(/\.json\.tmp$/, '').replace(/\.json$/, '');
        delete this.activeThreads[chatId];
        delete this.threadMeta[chatId];
        await fs.unlink(path.join(this.chatsDir, file)).catch(() => {});
        if (file.endsWith('.json')) deleted++;
      }
    } catch (e: any) {
      console.warn(`[History] clearAllChats failed: ${e.message}`);
    }
    return deleted;
  }

  async getHistoryLength(chatId: string): Promise<number> {
    await this.loadChat(chatId);
    return this.getActiveTurnCount(chatId);
  }
}

export const historyManager = new AgentHistoryManager();
