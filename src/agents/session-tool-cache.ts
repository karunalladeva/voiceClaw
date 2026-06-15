import { configManager } from '../config/index';

const RESPONSE_CACHE_TTL_MS = 2 * 60 * 1000;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export class SessionToolCache {
  private webSearch = new Map<string, CacheEntry>();
  private webFetch = new Map<string, CacheEntry>();

  private chatScope(chatId: string): string {
    return `chat:${chatId}`;
  }

  getWebSearch(chatId: string, key: string): string | null {
    const row = this.webSearch.get(`${this.chatScope(chatId)}:${key}`);
    if (!row || Date.now() > row.expiresAt) return null;
    return row.value;
  }

  setWebSearch(chatId: string, key: string, value: string): void {
    this.webSearch.set(`${this.chatScope(chatId)}:${key}`, {
      value,
      expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
    });
  }

  getWebFetch(chatId: string, key: string): string | null {
    const row = this.webFetch.get(`${this.chatScope(chatId)}:${key}`);
    if (!row || Date.now() > row.expiresAt) return null;
    return row.value;
  }

  setWebFetch(chatId: string, key: string, value: string): void {
    this.webFetch.set(`${this.chatScope(chatId)}:${key}`, {
      value,
      expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
    });
  }
}

export const sessionToolCache = new SessionToolCache();

export function isSessionDedupEnabled(): boolean {
  return configManager.getConfig().agent?.context?.dedup?.enabled !== false;
}
