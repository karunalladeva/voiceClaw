import { configManager } from '../config/index';

/**
 * Generic interface for cache storage strategies.
 */
interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  clear(): Promise<void>;
}

/**
 * In-memory storage using a simple Map.
 */
class MemoryStore implements CacheStore {
  private cache = new Map<string, { value: string; expires: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.cache.set(key, { value, expires: Date.now() + ttlMs });
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }
}

/**
 * Redis storage using ioredis.
 */
class RedisStore implements CacheStore {
  private client: any;
  private isAvailable = false;

  constructor(url: string) {
    this.init(url);
  }

  private async init(url: string) {
    try {
      // @ts-ignore - Optional dependency, handles missing module at runtime
      const { default: Redis } = await import('ioredis');

      this.client = new Redis(url, {
        maxRetriesPerRequest: 1,
        retryStrategy: (times: number) => (times > 3 ? null : 1000),
      });


      this.client.on('error', (err: any) => {
        console.error('[Cache: Redis] Error:', err.message);
        this.isAvailable = false;
      });

      this.client.on('connect', () => {
        console.log('[Cache: Redis] Connected.');
        this.isAvailable = true;
      });
    } catch (err) {
      console.warn('[Cache: Redis] ioredis not found or failed to load. Falling back to memory.');
      this.isAvailable = false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.isAvailable) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    if (!this.isAvailable) return;
    try {
      // Redis SET EX expects seconds
      await this.client.set(key, value, 'PX', ttlMs);
    } catch { /* ignore */ }
  }

  async clear(): Promise<void> {
    if (!this.isAvailable) return;
    try {
      await this.client.flushdb();
    } catch { /* ignore */ }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    }
  }
}


/**
 * Unified CacheManager that delegates to the configured store.
 */
export class CacheManager {
  private static instance: CacheManager;
  private store!: CacheStore;

  private constructor() {
    this.reinit();
    
    // Listen for config changes to swap store on the fly
    configManager.on('configChanged', () => {
      console.log('[Cache] Config changed, re-initializing store...');
      this.reinit();
    });
  }

  private reinit() {
    const config = configManager.getConfig().cache;
    
    // Cleanup previous store if needed
    if (this.store instanceof RedisStore) {
      console.log('[Cache] Closing previous Redis connection...');
      (this.store as any).disconnect?.();
    }

    if (config.mode === 'redis' && config.redisUrl) {
      console.log(`[Cache] Switching to Redis store: ${config.redisUrl}`);
      this.store = new RedisStore(config.redisUrl);
    } else {
      console.log('[Cache] Switching to Memory store.');
      this.store = new MemoryStore();
    }
  }

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.store.set(key, value, ttlMs);
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}


export const cache = CacheManager.getInstance();
