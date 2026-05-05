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
}

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
