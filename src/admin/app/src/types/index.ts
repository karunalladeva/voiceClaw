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
  assistantName: string
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
