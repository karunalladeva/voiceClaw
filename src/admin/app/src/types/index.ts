export interface Stats {
  totalRequests: number
  totalTokens: number
  totalToolCalls: number
  totalErrors: number
  uptimeMs: number
  activeAgentCount: number
  mainAgentCount: number
  skillAgentCount: number
}

export interface Runtime {
  activeSkillExecutions: number
  queuedSkillExecutions: number
  maxParallelSkills: number
  totalSkillQueueTimeouts: number
}

export interface MCPMetrics {
  successRate: number
  totalCalls: number
  connectedServers: number
  loadedTools: number
  failedCalls: number
  totalMemoryCalls: number
}

export interface Metrics {
  runtime?: Runtime
  mcp?: MCPMetrics
  agentEvents?: Partial<Stats>
}

export interface ToolCall {
  name: string
  completedAt?: number
}

export interface Agent {
  chatId: string
  agentType: 'main' | 'skill'
  status: 'thinking' | 'tool_call' | 'streaming' | 'completed' | 'error'
  input?: string
  tokenCount: number
  startedAt: number
  toolCalls: ToolCall[]
  skillId?: string
  skillName?: string
}

export interface AgentEvent {
  type: string
  timestamp: number
  agentId?: string
  chatId?: string
  data: Record<string, unknown>
}

export interface Model {
  id: string
  name?: string
  model: string
  provider: string
  baseUrl?: string
  enabled: boolean
  isMaster?: boolean
  role?: string
  capabilities?: Record<string, unknown>
}

export interface AppConfig {
  llm: {
    model: string
    temperature: number
  }
  stt: {
    mode: 'transcribe' | 'direct'
  }
  tts: {
    engine: 'kokoro' | 'qwen'
    defaultVoice: string
  }
  agent: {
    enableInternet: boolean
    maxParallelSkills: number
    skillQueueTimeoutMs: number
    maxPromptChars?: number
    microRouter?: {
      enabled?: boolean
      useLlmFallback?: boolean
      keepAlive?: boolean
      modelId?: string
      bm25MarginThreshold?: number
      maxMatches?: number
      generalLaneBias?: number
      specialistMinMargin?: number
      cacheTtlMs?: number
    }
    historyContext?: {
      ranking?: 'recency' | 'bm25' | 'embedding'
      embedModel?: string
      embedBaseUrl?: string
      minRecentTurns?: number
    }
    artifactOnlyIo?: boolean
    allowUpstreamArtifactReads?: boolean
    requirePipelineWorkflow?: boolean
    verifyActWrite?: boolean
  }
  memory: {
    enabled: boolean
  }
  learning: {
    autoMemoryStore: boolean
    autoSkillCreate: boolean
    autoMacroCreate: boolean
    retryOnFail: boolean
    maxRetries: number
  }
  cache: {
    mode: 'memory' | 'redis'
    redisUrl?: string
  }
  voiceHandling: {
    vadEnabled: boolean
    wakeWordEnabled: boolean
    autoListen: boolean
  }
  comfyui?: {
    enabled: boolean
    baseUrl: string
    requestTimeoutMs: number
    outputDir: string
    maxConcurrentJobs: number
    unloadLocalModelOnGenerate?: boolean
    pauseOrchestrationDuringGenerate?: boolean
    orchestrationPauseMaxWaitMs?: number
  }
  searxng?: {
    enabled: boolean
    baseUrl: string
    categories: string
    timeRange: string
    language: string
  }
  webSearch?: {
    httpFallbackEnabled: boolean
    browserFallbackEnabled: boolean
    snippetConfidenceTags?: boolean
    multiQueryRrf?: boolean
    rrfK?: number
  }
  webFetch?: {
    maxChars: number
    chunkRanking: 'bm25' | 'head' | 'embedding'
    chunkMinChars: number
    chunkOverlapChars: number
    embedModel: string
    embedBaseUrl: string
    ignoreTlsErrors: boolean
    proxyUrl: string
    rejectShellContent?: boolean
    stripBoilerplate?: boolean
    expandRankingQuery?: boolean
  }
  llamacpp?: {
    enabled: boolean
    baseUrl: string
    host: string
    port: number
    serverBinary: string
    modelsDir: string
    modelsMax: number
    modelsPreset: string
    noModelsAutoload: boolean
    ctxSize: number
    nGpuLayers: number
    threads: number
    manageProcess: boolean
    apiKey: string
  }
  assistantName: string
  debug: {
    enabled: boolean
    logLlmIo: boolean
  }
}

export interface MemoryEntry {
  id: string
  content: string
  tags?: string[]
  createdAt?: string
}

export interface MemoryStatus {
  available: boolean
  enabled: boolean
}

export interface LearnedSkill {
  name: string
  description: string
  content: string
  stage: 'draft' | 'validated' | 'enabled'
}

export interface WorkspaceFile {
  name: string
  isDir: boolean
  sizeBytes: number
  modifiedAt: string | null
}

export type WorkspaceCategories = Record<string, WorkspaceFile[]>

export interface SystemInfo {
  platform: string
  arch: string
  hostname: string
  uptime: number
  cpuCount: number
  cpuModel: string
  totalMemoryGB: string
  freeMemoryGB: string
  memoryUsagePercent: string
  nodeVersion: string
  pid: number
}

export type WebSocketMessage =
  | { type: 'connected'; clientId: string; serverTime: number }
  | { type: 'snapshot'; stats: Stats; activeAgents: Agent[]; recentEvents: AgentEvent[] }
  | { type: 'stats'; stats: Stats; activeAgents: Agent[] }
  | { type: 'event'; event: AgentEvent }
  | { type: 'error'; message: string }

export interface ChannelConfig {
  type: string
  name: string
  settings: Record<string, string>
  enabled: boolean
}

export interface PendingPairing {
  code: string
  channelType: string
  senderId: string
  senderName: string
}

export type ApprovedPairings = Record<string, string[]>

export interface PipelineStep {
  type: string
  config?: Record<string, unknown>
}

export interface Pipeline {
  id: string
  name: string
  trigger: 'scheduled' | 'manual' | 'on_event'
  schedule?: string
  steps: PipelineStep[]
  enabled: boolean
  runOnStartup?: boolean
  createdAt: number
  lastRun?: number
  nextRun?: number
}

export interface PipelineStepResult {
  type: string
  success: boolean
  output: string
}

export interface PipelineHistoryEntry {
  pipelineId: string
  pipelineName: string
  ranAt: number
  success: boolean
  stepResults: PipelineStepResult[]
}
