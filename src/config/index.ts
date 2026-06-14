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
    /** Max total chars (system + history + human) before inference. */
    maxPromptChars: number;
    /** Gateway micro-router: BM25 / tiny-model lane before full skill catalog injection. */
    microRouter?: {
      enabled?: boolean;
      /** Use fast/summarize model when BM25 margin is ambiguous. */
      useLlmFallback?: boolean;
      /** Optional models-config id override (else role=fast). */
      modelId?: string;
      /** Min BM25 score gap between top-2 lanes before LLM fallback. */
      bm25MarginThreshold?: number;
      /** Max skill/tool/MCP matches kept for prompt focus. */
      maxMatches?: number;
      /** Extra weight for general lane in catalog voting. */
      generalLaneBias?: number;
      /** Specialist lane must beat general by this margin or fall back to general. */
      specialistMinMargin?: number;
      cacheTtlMs?: number;
      /** Keep LLM fallback model loaded (Ollama keep_alive=-1) between route calls. */
      keepAlive?: boolean;
    };
    /** How prior chat turns are selected when history exceeds the prompt budget. */
    historyContext?: {
      /** recency = newest-first (legacy); bm25 | embedding = query-ranked older turns. */
      ranking?: 'recency' | 'bm25' | 'embedding';
      /** Embedding model id (Ollama-compatible); defaults to webFetch.embedModel. */
      embedModel?: string;
      /** Embedding API base URL; defaults to webFetch.embedBaseUrl. */
      embedBaseUrl?: string;
      /** User/assistant turn pairs always kept at the tail before ranking older turns. */
      minRecentTurns?: number;
    };
    /** Pipeline-mode: restrict read_file to allowlisted artifact paths. */
    artifactOnlyIo?: boolean;
    /** Pipeline-mode: allow reading completed upstream artifact folders. */
    allowUpstreamArtifactReads?: boolean;
    /** Pipeline-mode: manager must write pipeline/workflow.json before delegate. */
    requirePipelineWorkflow?: boolean;
    /** Verify-act read-back after write_file during org tasks. */
    verifyActWrite?: boolean;
  };
  pipeline: {
    /** Max chars of research context passed into summarize / synthesis human message. */
    contextMaxChars: number;
    /** Max chars for task-scoped artifact RAG excerpt in heartbeat context. */
    artifactRagMaxChars?: number;
    /** Map-reduce upstream context when inputContext exceeds this. */
    mapReduceThresholdChars?: number;
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
    /** Pause org heartbeats and wait for other agents before ComfyUI jobs. */
    pauseOrchestrationDuringGenerate: boolean;
    /** Max ms to wait for other agents' heartbeats to finish before starting ComfyUI. */
    orchestrationPauseMaxWaitMs: number;
  };
  searxng: {
    enabled: boolean;
    baseUrl: string;
    categories: string;
    timeRange: string;
    language: string;
  };
  webSearch: {
    httpFallbackEnabled: boolean;
    browserFallbackEnabled: boolean;
    /** Tag search snippets with Confidence: LOW. */
    snippetConfidenceTags?: boolean;
    /** Merge multi-query SearXNG results with RRF. */
    multiQueryRrf?: boolean;
    /** RRF k parameter (default 60). */
    rrfK?: number;
  };
  webFetch: {
    maxChars: number;
    chunkRanking: 'bm25' | 'head' | 'embedding';
    chunkMinChars: number;
    chunkOverlapChars: number;
    embedModel: string;
    embedBaseUrl: string;
    ignoreTlsErrors: boolean;
    proxyUrl: string;
    /** Reject navigation-shell pages as LOW confidence. */
    rejectShellContent?: boolean;
    /** Strip boilerplate lines after extraction. */
    stripBoilerplate?: boolean;
    /** Expand BM25 query from search + user context. */
    expandRankingQuery?: boolean;
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
  debug: {
    /** Verbose debug logs in server console and admin live events. */
    enabled: boolean;
    /** Log full messages sent to and received from the LLM. */
    logLlmIo: boolean;
  };
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
    maxPromptChars: 30_000,
    microRouter: {
      enabled: true,
      useLlmFallback: true,
      bm25MarginThreshold: 0.12,
      generalLaneBias: 0.12,
      specialistMinMargin: 0.1,
      cacheTtlMs: 120_000,
      keepAlive: true,
    },
    historyContext: {
      ranking: 'recency',
      minRecentTurns: 2,
    },
    artifactOnlyIo: true,
    allowUpstreamArtifactReads: true,
    requirePipelineWorkflow: true,
    verifyActWrite: true,
  },
  pipeline: {
    contextMaxChars: 15_000,
    artifactRagMaxChars: 3000,
    mapReduceThresholdChars: 12_000,
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
    pauseOrchestrationDuringGenerate: true,
    orchestrationPauseMaxWaitMs: 120_000,
  },
  searxng: {
    enabled: true,
    baseUrl: 'http://localhost:7979',
    categories: '',
    timeRange: '',
    language: 'en',
  },
  webSearch: {
    httpFallbackEnabled: true,
    browserFallbackEnabled: true,
    snippetConfidenceTags: true,
    multiQueryRrf: true,
    rrfK: 60,
  },
  webFetch: {
    maxChars: 12000,
    chunkRanking: 'bm25',
    chunkMinChars: 200,
    chunkOverlapChars: 250,
    embedModel: 'nomic-embed-text',
    embedBaseUrl: 'http://localhost:11434',
    ignoreTlsErrors: false,
    proxyUrl: '',
    rejectShellContent: true,
    stripBoilerplate: true,
    expandRankingQuery: true,
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
  debug: {
    enabled: false,
    logLlmIo: false,
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
          searxng: { ...DEFAULT_CONFIG.searxng, ...(parsed.searxng || {}) },
          webSearch: { ...DEFAULT_CONFIG.webSearch, ...(parsed.webSearch || {}) },
          webFetch: { ...DEFAULT_CONFIG.webFetch, ...(parsed.webFetch || {}) },
          llamacpp: { ...DEFAULT_CONFIG.llamacpp, ...(parsed.llamacpp || {}) },
          pipeline: { ...DEFAULT_CONFIG.pipeline, ...(parsed.pipeline || {}) },
          agent: { ...DEFAULT_CONFIG.agent, ...(parsed.agent || {}) },
          debug: { ...DEFAULT_CONFIG.debug, ...(parsed.debug || {}) },
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
              searxng: { ...this.currentConfig.searxng, ...(newConfig.searxng || {}) },
              webSearch: { ...this.currentConfig.webSearch, ...(newConfig.webSearch || {}) },
              webFetch: { ...this.currentConfig.webFetch, ...(newConfig.webFetch || {}) },
              llamacpp: { ...this.currentConfig.llamacpp, ...(newConfig.llamacpp || {}) },
              pipeline: { ...this.currentConfig.pipeline, ...(newConfig.pipeline || {}) },
              agent: { ...this.currentConfig.agent, ...(newConfig.agent || {}) },
              debug: { ...this.currentConfig.debug, ...(newConfig.debug || {}) },
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

  /** Resolve SearXNG base URL with env override. */
  getSearxngBaseUrl(): string {
    return (process.env.SEARXNG_URL?.trim() || this.currentConfig.searxng.baseUrl).replace(/\/$/, '');
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
    const searxUrl = process.env.SEARXNG_URL?.trim();
    if (searxUrl) {
      this.currentConfig.searxng = { ...this.currentConfig.searxng, baseUrl: searxUrl };
    }
    const searxEnabled = process.env.SEARXNG_ENABLED?.trim().toLowerCase();
    if (searxEnabled === 'true' || searxEnabled === 'false') {
      this.currentConfig.searxng = {
        ...this.currentConfig.searxng,
        enabled: searxEnabled === 'true',
      };
    }
    const searxCategories = process.env.SEARXNG_CATEGORIES?.trim();
    if (searxCategories) {
      this.currentConfig.searxng = { ...this.currentConfig.searxng, categories: searxCategories };
    }
    const searxTimeRange = process.env.SEARXNG_TIME_RANGE?.trim();
    if (searxTimeRange) {
      this.currentConfig.searxng = { ...this.currentConfig.searxng, timeRange: searxTimeRange };
    }
    const searxLanguage = process.env.SEARXNG_LANGUAGE?.trim();
    if (searxLanguage) {
      this.currentConfig.searxng = { ...this.currentConfig.searxng, language: searxLanguage };
    }
    const httpFallback = process.env.WEB_SEARCH_HTTP_FALLBACK?.trim().toLowerCase();
    if (httpFallback === 'true' || httpFallback === 'false') {
      this.currentConfig.webSearch = {
        ...this.currentConfig.webSearch,
        httpFallbackEnabled: httpFallback === 'true',
      };
    }
    const browserFallback = process.env.WEB_SEARCH_BROWSER_FALLBACK?.trim().toLowerCase();
    if (browserFallback === 'true' || browserFallback === 'false') {
      this.currentConfig.webSearch = {
        ...this.currentConfig.webSearch,
        browserFallbackEnabled: browserFallback === 'true',
      };
    }
    const fetchMax = process.env.WEB_FETCH_MAX_CHARS?.trim();
    if (fetchMax && !Number.isNaN(Number(fetchMax))) {
      this.currentConfig.webFetch = {
        ...this.currentConfig.webFetch,
        maxChars: Math.max(1000, Number(fetchMax)),
      };
    }
    const fetchProxy = process.env.WEB_FETCH_PROXY_URL?.trim();
    if (fetchProxy) {
      this.currentConfig.webFetch = { ...this.currentConfig.webFetch, proxyUrl: fetchProxy };
    }
    const fetchTls = process.env.WEB_FETCH_IGNORE_TLS_ERRORS?.trim().toLowerCase();
    if (fetchTls === 'true' || fetchTls === 'false') {
      this.currentConfig.webFetch = {
        ...this.currentConfig.webFetch,
        ignoreTlsErrors: fetchTls === 'true',
      };
    }
    const maxPrompt = process.env.AGENT_MAX_PROMPT_CHARS?.trim();
    if (maxPrompt && !Number.isNaN(Number(maxPrompt))) {
      this.currentConfig.agent = {
        ...this.currentConfig.agent,
        maxPromptChars: Math.max(8000, Number(maxPrompt)),
      };
    }
    const pipelineContext = process.env.PIPELINE_CONTEXT_MAX_CHARS?.trim();
    if (pipelineContext && !Number.isNaN(Number(pipelineContext))) {
      this.currentConfig.pipeline = {
        ...this.currentConfig.pipeline,
        contextMaxChars: Math.max(4000, Number(pipelineContext)),
      };
    }
  }

  async updateConfig(newSettings: Partial<AppConfig>) {
    this.currentConfig = {
      ...this.currentConfig,
      ...newSettings,
      llm: { ...this.currentConfig.llm, ...(newSettings.llm || {}) },
      stt: { ...this.currentConfig.stt, ...(newSettings.stt || {}) },
      tts: { ...this.currentConfig.tts, ...(newSettings.tts || {}) },
      agent: {
        ...this.currentConfig.agent,
        ...(newSettings.agent || {}),
        ...(newSettings.agent?.microRouter || this.currentConfig.agent?.microRouter
          ? {
              microRouter: {
                ...this.currentConfig.agent?.microRouter,
                ...(newSettings.agent?.microRouter || {}),
              },
            }
          : {}),
        ...(newSettings.agent?.historyContext || this.currentConfig.agent?.historyContext
          ? {
              historyContext: {
                ...this.currentConfig.agent?.historyContext,
                ...(newSettings.agent?.historyContext || {}),
              },
            }
          : {}),
      },
      pipeline: { ...this.currentConfig.pipeline, ...(newSettings.pipeline || {}) },
      memory: { ...this.currentConfig.memory, ...(newSettings.memory || {}) },
      learning: { ...this.currentConfig.learning, ...(newSettings.learning || {}) },
      evolution: { ...this.currentConfig.evolution, ...(newSettings.evolution || {}) },
      speech: { ...this.currentConfig.speech, ...(newSettings.speech || {}) },
      marketData: { ...this.currentConfig.marketData, ...(newSettings.marketData || {}) },
      comfyui: { ...this.currentConfig.comfyui, ...(newSettings.comfyui || {}) },
      searxng: { ...this.currentConfig.searxng, ...(newSettings.searxng || {}) },
      webSearch: { ...this.currentConfig.webSearch, ...(newSettings.webSearch || {}) },
      webFetch: { ...this.currentConfig.webFetch, ...(newSettings.webFetch || {}) },
      llamacpp: { ...this.currentConfig.llamacpp, ...(newSettings.llamacpp || {}) },
      debug: { ...this.currentConfig.debug, ...(newSettings.debug || {}) },
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