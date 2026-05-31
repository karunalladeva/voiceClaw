import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

export interface AppConfig {
  llm: {
    model: string;
    temperature: number;
  };
  stt: {
    mode: 'transcribe' | 'direct';
  };
  tts: {
    engine: 'kokoro' | 'qwen';
    defaultVoice: string;
  };
  agent: {
    enableInternet: boolean;
    maxParallelSkills: number;
    skillQueueTimeoutMs: number;
  };
  memory: {
    enabled: boolean;
  };
  learning: {
    autoMemoryStore: boolean;
    autoSkillCreate: boolean;
    autoMacroCreate: boolean;
    retryOnFail: boolean;
    maxRetries: number;
  };
  cache: {
    mode: 'memory' | 'redis';
    redisUrl?: string;
  };
  voiceHandling: {
    vadEnabled: boolean;
    wakeWordEnabled: boolean;
    autoListen: boolean;
  };
  speech: {
    finalOnly: boolean;
    longTextThresholdChars: number;
    minimalSummaryEnabled: boolean;
    fallbackMaxChars: number;
    truncationSuffix: string;
  };
  marketData: {
    mcpServerScriptPath: string;
    mcpCommand: string;
    mcpArgs: string[];
    requestTimeoutMs: number;
    enableCcxt: boolean;
  };
  evolution: {
    enabled: boolean;
    autoHarvest: boolean;
    schedule: string;
    minSamples: number;
    vramMaxMB: number;
    baseModel: string;
    loraRank: number;
    maxTrainSteps: number;
    learningRate: number;
    quantMethod: string;
  };
  comfyui: {
    enabled: boolean;
    baseUrl: string;
    requestTimeoutMs: number;
    outputDir: string;
    maxConcurrentJobs: number;
    unloadLocalModelOnGenerate: boolean;
  };
  llamacpp: {
    enabled: boolean;
    baseUrl: string;
    host: string;
    port: number;
    serverBinary: string;
    modelsDir: string;
    modelsMax: number;
    modelsPreset: string;
    noModelsAutoload: boolean;
    ctxSize: number;
    nGpuLayers: number;
    threads: number;
    manageProcess: boolean;
    apiKey: string;
  };
  assistantName: string;
  approved_senders: Record<string, string[]>;
}


const DEFAULT_CONFIG: AppConfig = {
  llm: {
    model: 'qwen3.5:9b',
    temperature: 0.2,
  },
  stt: {
    mode: 'transcribe',
  },
  tts: {
    engine: 'kokoro',
    defaultVoice: 'af_heart',
  },
  agent: {
    enableInternet: true,
    maxParallelSkills: 2,
    skillQueueTimeoutMs: 30000,
  },
  memory: {
    enabled: true,
  },
  learning: {
    autoMemoryStore: true,
    autoSkillCreate: true,
    autoMacroCreate: true,
    retryOnFail: true,
    maxRetries: 3,
  },
  cache: {
    mode: 'memory',
    redisUrl: 'redis://localhost:6379',
  },
  voiceHandling: {
    vadEnabled: true,
    wakeWordEnabled: false,
    autoListen: false,
  },
  speech: {
    finalOnly: true,
    longTextThresholdChars: 1200,
    minimalSummaryEnabled: true,
    fallbackMaxChars: 500,
    truncationSuffix: "I've placed the rest of the details on your screen.",
  },
  marketData: {
    mcpServerScriptPath: path.join(process.cwd(), 'src', 'mcp-servers', 'market', 'index.ts'),
    mcpCommand: 'npx',
    mcpArgs: [],
    requestTimeoutMs: 8000,
    enableCcxt: false,
  },
  evolution: {
    enabled: false,
    autoHarvest: true,
    schedule: '0 3 * * 0',
    minSamples: 100,
    vramMaxMB: 2048,
    baseModel: 'unsloth/llama-3.1-8b-bnb-4bit',
    loraRank: 16,
    maxTrainSteps: 60,
    learningRate: 2e-4,
    quantMethod: 'q4_k_m',
  },
  comfyui: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:8000',
    requestTimeoutMs: 300000,
    outputDir: 'workspace/generated',
    maxConcurrentJobs: 1,
    unloadLocalModelOnGenerate: true,
  },
  llamacpp: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:8080',
    host: '127.0.0.1',
    port: 8080,
    serverBinary: '',
    modelsDir: '',
    modelsMax: 4,
    modelsPreset: '',
    noModelsAutoload: false,
    ctxSize: 8192,
    nGpuLayers: -1,
    threads: 0,
    manageProcess: false,
    apiKey: '',
  },
  assistantName: 'Claw',
  approved_senders: {
    discord: [],
    telegram: [],
    whatsapp: [],
    slack: []
  },
};



class ConfigManager extends EventEmitter {
  private configPath: string;
  private currentConfig: AppConfig;
  private watcher: fsSync.FSWatcher | null = null;

  constructor() {
    super();
    this.configPath = path.join(process.cwd(), 'workspace', 'config.json');
    this.currentConfig = { ...DEFAULT_CONFIG };
  }

  async initialize() {
    try {
      // Ensure workspace exists
      await fs.mkdir(path.dirname(this.configPath), { recursive: true });
      
      try {
        const fileContent = await fs.readFile(this.configPath, 'utf-8');
        const parsed = JSON.parse(fileContent) as Partial<AppConfig>;
        this.currentConfig = {
          ...DEFAULT_CONFIG,
          ...parsed,
          speech: { ...DEFAULT_CONFIG.speech, ...(parsed.speech || {}) },
          marketData: { ...DEFAULT_CONFIG.marketData, ...(parsed.marketData || {}) },
          comfyui: { ...DEFAULT_CONFIG.comfyui, ...(parsed.comfyui || {}) },
          llamacpp: { ...DEFAULT_CONFIG.llamacpp, ...(parsed.llamacpp || {}) },
        };
        this.applyEnvOverrides();
        console.log('[Config] Loaded existing configuration.');
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          console.log('[Config] No config file found. Creating default config.');
          await this.saveConfig(this.currentConfig);
        } else {
          console.error('[Config] Error reading config file:', err);
        }
      }
      this.applyEnvOverrides();

      this.setupWatcher();
    } catch (error) {
      console.error('[Config] Failed to initialize config manager:', error);
    }
  }

  private setupWatcher() {
    if (this.watcher) {
      this.watcher.close();
    }

    try {
      this.watcher = fsSync.watch(this.configPath, async (eventType) => {
        if (eventType === 'change') {
          console.log('[Config] Configuration file changed on disk. Reloading...');
          try {
            const fileContent = await fs.readFile(this.configPath, 'utf-8');
            const newConfig = JSON.parse(fileContent) as Partial<AppConfig>;
            this.currentConfig = {
              ...this.currentConfig,
              ...newConfig,
              speech: { ...this.currentConfig.speech, ...(newConfig.speech || {}) },
              marketData: { ...this.currentConfig.marketData, ...(newConfig.marketData || {}) },
              comfyui: { ...this.currentConfig.comfyui, ...(newConfig.comfyui || {}) },
              llamacpp: { ...this.currentConfig.llamacpp, ...(newConfig.llamacpp || {}) },
            };
            this.applyEnvOverrides();
            this.emit('configChanged', this.currentConfig);
            console.log('[Config] Hot-reloaded configuration successfully.');
          } catch (err) {
            console.error('[Config] Failed to hot-reload configuration:', err);
          }
        }
      });
    } catch (err) {
      console.error('[Config] Could not setup file watcher:', err);
    }
  }

  getConfig(): AppConfig {
    return { ...this.currentConfig };
  }

  /** Resolve ComfyUI base URL with env override. */
  getComfyUIBaseUrl(): string {
    return process.env.COMFYUI_BASE_URL?.trim() || this.currentConfig.comfyui.baseUrl;
  }

  /** Resolve llama.cpp server base URL with env override. */
  getLlamaCppBaseUrl(): string {
    const envUrl = process.env.LLAMACPP_BASE_URL?.trim();
    if (envUrl) return envUrl.replace(/\/+$/, '');
    const cfg = this.currentConfig.llamacpp;
    if (cfg.baseUrl?.trim()) return cfg.baseUrl.replace(/\/+$/, '');
    return `http://${cfg.host || '127.0.0.1'}:${cfg.port || 8080}`;
  }

  private applyEnvOverrides(): void {
    const comfyUrl = process.env.COMFYUI_BASE_URL?.trim();
    if (comfyUrl) {
      this.currentConfig.comfyui = { ...this.currentConfig.comfyui, baseUrl: comfyUrl };
    }
    const llamaUrl = process.env.LLAMACPP_BASE_URL?.trim();
    if (llamaUrl) {
      this.currentConfig.llamacpp = { ...this.currentConfig.llamacpp, baseUrl: llamaUrl };
    }
  }

  async updateConfig(newSettings: Partial<AppConfig>) {
    this.currentConfig = {
      ...this.currentConfig,
      ...newSettings,
      llm: { ...this.currentConfig.llm, ...(newSettings.llm || {}) },
      stt: { ...this.currentConfig.stt, ...(newSettings.stt || {}) },
      tts: { ...this.currentConfig.tts, ...(newSettings.tts || {}) },
      agent: { ...this.currentConfig.agent, ...(newSettings.agent || {}) },
      memory: { ...this.currentConfig.memory, ...(newSettings.memory || {}) },
      learning: { ...this.currentConfig.learning, ...(newSettings.learning || {}) },
      evolution: { ...this.currentConfig.evolution, ...(newSettings.evolution || {}) },
      speech: { ...this.currentConfig.speech, ...(newSettings.speech || {}) },
      marketData: { ...this.currentConfig.marketData, ...(newSettings.marketData || {}) },
      comfyui: { ...this.currentConfig.comfyui, ...(newSettings.comfyui || {}) },
      llamacpp: { ...this.currentConfig.llamacpp, ...(newSettings.llamacpp || {}) },
      approved_senders: newSettings.approved_senders || this.currentConfig.approved_senders,
    };
    this.applyEnvOverrides();
    
    await this.saveConfig(this.currentConfig);
    this.emit('configChanged', this.currentConfig);
  }

  private async saveConfig(config: AppConfig) {
    try {
      // Temporarily remove watcher to avoid triggering our own change event
      if (this.watcher) this.watcher.close();
      
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
      
      // Re-attach watcher
      this.setupWatcher();
    } catch (err) {
      console.error('[Config] Failed to save configuration:', err);
    }
  }
}

export const configManager = new ConfigManager();