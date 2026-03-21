import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import { ModelConfig, ModelCapabilities, ModelRegistryData } from './types';
import { detectCapabilities, detectCapabilitiesOffline } from './capability-detector';
import { configManager } from '../config/index';

const REGISTRY_PATH = path.join(process.cwd(), 'workspace', 'models-config.json');

/** Re-detect capabilities after this many days */
const CAPABILITY_TTL_DAYS = 7;
const CAPABILITY_TTL_MS = CAPABILITY_TTL_DAYS * 24 * 60 * 60 * 1000;

function buildDefaultModels(): ModelConfig[] {
  const cfg = configManager.getConfig();
  return [
    {
      id: 'master',
      name: 'Master (Ollama)',
      role: 'master',
      provider: 'ollama',
      model: cfg.llm?.model || 'qwen3.5:9b',
      baseUrl: 'http://localhost:11434',
      enabled: true,
      isMaster: true,
      tags: ['local', 'default'],
      description: 'Primary conversation / orchestration model',
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────

export class ModelRegistry extends EventEmitter {
  private models: ModelConfig[] = [];
  private initialized = false;
  private _changedDebounce: ReturnType<typeof setTimeout> | null = null;

  /** Debounced emit so rapid successive saves don't cascade reloads. */
  private emitChanged() {
    if (this._changedDebounce) clearTimeout(this._changedDebounce);
    this._changedDebounce = setTimeout(() => {
      this._changedDebounce = null;
      this.emit('changed');
    }, 500);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async initialize() {
    await this.load();
    // Fire-and-forget capability detection for stale entries so startup is fast
    this.refreshStale().catch((err) =>
      console.error('[ModelRegistry] Background refresh error:', err)
    );
    this.initialized = true;
  }

  private async load() {
    await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
    try {
      const raw = await fs.readFile(REGISTRY_PATH, 'utf-8');
      const data = JSON.parse(raw) as ModelRegistryData;
      this.models = data.models || buildDefaultModels();
      console.log(`[ModelRegistry] Loaded ${this.models.length} model(s).`);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.models = buildDefaultModels();
        await this.save();
        console.log('[ModelRegistry] Created default models-config.json.');
      } else {
        console.error('[ModelRegistry] Load error:', err.message);
        this.models = buildDefaultModels();
      }
    }
  }

  private async save() {
    const data: ModelRegistryData = {
      version: 1,
      models: this.models,
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf-8');
  }

  private isStale(m: ModelConfig): boolean {
    if (!m.capabilities || !m.capabilitiesDetectedAt) return true;
    return Date.now() - new Date(m.capabilitiesDetectedAt).getTime() > CAPABILITY_TTL_MS;
  }

  /** Background: detect capabilities for stale or new models */
  async refreshStale() {
    const stale = this.models.filter((m) => m.enabled && this.isStale(m));
    if (!stale.length) return;
    console.log(`[ModelRegistry] Detecting capabilities for ${stale.length} model(s)…`);

    for (const m of stale) {
      try {
        m.capabilities = await detectCapabilities(m);
        m.capabilitiesDetectedAt = new Date().toISOString();
        console.log(`[ModelRegistry] ✓ Capabilities cached for: ${m.id}`);
      } catch (err: any) {
        // Fallback to offline detection so we still have useful metadata
        m.capabilities = detectCapabilitiesOffline(m);
        m.capabilitiesDetectedAt = new Date().toISOString();
        console.warn(`[ModelRegistry] Offline fallback for "${m.id}": ${err.message}`);
      }
    }
    await this.save();
  }

  // ── Read helpers ──────────────────────────────────────────────────────────

  getAll(): ModelConfig[] {
    return [...this.models];
  }

  getEnabled(): ModelConfig[] {
    return this.models.filter((m) => m.enabled);
  }

  getMaster(): ModelConfig | undefined {
    return this.models.find((m) => m.isMaster && m.enabled);
  }

  getById(id: string): ModelConfig | undefined {
    return this.models.find((m) => m.id === id);
  }

  /**
   * Best model for a specific capability:
   *  1. Enabled specialist whose role matches the capability
   *  2. Any enabled model that has the capability (non-master first)
   *  3. Master as final fallback
   */
  getBestFor(capability: keyof ModelCapabilities): ModelConfig | undefined {
    const enabled = this.models.filter((m) => m.enabled);
    // Prefer specialist roles first
    const specialist = enabled.find(
      (m) =>
        !m.isMaster &&
        m.capabilities?.[capability] === true &&
        (Array.isArray(m.role) ? m.role : [m.role]).includes(capability as any)
    );
    if (specialist) return specialist;

    // Any enabled model with the capability (non-master preferred)
    const any = enabled
      .filter((m) => m.capabilities?.[capability] === true)
      .sort((a, b) => (a.isMaster ? 1 : 0) - (b.isMaster ? 1 : 0));
    return any[0] || this.getMaster();
  }

  // ── Write operations ──────────────────────────────────────────────────────

  async addOrUpdate(config: ModelConfig): Promise<ModelConfig> {
    // Enforce single master
    if (config.isMaster) {
      this.models.forEach((m) => (m.isMaster = false));
    }

    // Fill in offline capabilities immediately if not provided
    if (!config.capabilities) {
      config.capabilities = detectCapabilitiesOffline(config);
      config.capabilitiesDetectedAt = new Date().toISOString();
    }

    const idx = this.models.findIndex((m) => m.id === config.id);
    if (idx >= 0) {
      this.models[idx] = config;
    } else {
      this.models.push(config);
    }

    await this.save();
    this.emitChanged();

    // Async live detection without blocking the response
    this.detectAndSave(config.id).catch(() => {});
    return config;
  }

  async delete(id: string): Promise<boolean> {
    const idx = this.models.findIndex((m) => m.id === id);
    if (idx < 0) return false;
    this.models.splice(idx, 1);
    await this.save();
    this.emitChanged();
    return true;
  }

  async setMaster(id: string): Promise<boolean> {
    const target = this.getById(id);
    if (!target || !target.enabled) return false;
    this.models.forEach((m) => (m.isMaster = m.id === id));
    await this.save();
    this.emitChanged();
    return true;
  }

  async detectAndSave(id: string): Promise<ModelCapabilities | null> {
    const m = this.getById(id);
    if (!m) return null;
    m.capabilities = await detectCapabilities(m);
    m.capabilitiesDetectedAt = new Date().toISOString();
    await this.save();
    // NOTE: do NOT emit 'changed' here — detectAndSave is a background
    // persistence operation that does not require a full agent rebuild.
    return m.capabilities;
  }
}

export const modelRegistry = new ModelRegistry();
