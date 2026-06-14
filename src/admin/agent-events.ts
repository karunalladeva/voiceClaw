import { EventEmitter } from 'events';

export type AgentEventType =
  | 'agent:created'
  | 'agent:started'
  | 'agent:completed'
  | 'agent:error'
  | 'agent:thinking'
  | 'agent:spawned'
  | 'tool:started'
  | 'tool:completed'
  | 'tool:error'
  | 'model:loading'
  | 'model:loaded'
  | 'model:inference_start'
  | 'model:inference_end'
  | 'model:token'
  | 'skill:routing'
  | 'skill:started'
  | 'skill:completed'
  | 'memory:search'
  | 'memory:stored'
  | 'system:log'
  | 'debug:llm_request'
  | 'debug:llm_response';

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  timestamp: number;
  chatId?: string;
  agentId?: string;
  data: {
    message?: string;
    toolName?: string;
    toolArgs?: any;
    toolResult?: string;
    skillId?: string;
    skillName?: string;
    modelId?: string;
    token?: string;
    duration?: number;
    input?: string;
    output?: string;
    error?: string;
    level?: 'info' | 'warn' | 'error' | 'debug';
    [key: string]: any;
  };
}

export interface ActiveAgent {
  id: string;
  chatId: string;
  startedAt: number;
  status: 'thinking' | 'tool_call' | 'streaming' | 'completed' | 'error';
  agentType: 'main' | 'skill';
  skillId?: string;
  skillName?: string;
  parentAgentId?: string;
  currentTool?: string;
  input?: string;
  tokenCount: number;
  toolCalls: Array<{ name: string; startedAt: number; completedAt?: number; success?: boolean }>;
}

class AgentEventEmitter extends EventEmitter {
  private events: AgentEvent[] = [];
  private maxEvents = 1000;
  private activeAgents: Map<string, ActiveAgent> = new Map();
  private stats = {
    totalRequests: 0,
    totalTokens: 0,
    totalToolCalls: 0,
    totalErrors: 0,
    startTime: Date.now(),
  };

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  emit(type: AgentEventType, data: Partial<AgentEvent['data']> & { chatId?: string; agentId?: string }): boolean {
    const event: AgentEvent = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      type,
      timestamp: Date.now(),
      chatId: data.chatId,
      agentId: data.agentId,
      data,
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    this.updateStats(event);
    this.updateActiveAgents(event);

    return super.emit('event', event);
  }

  private updateStats(event: AgentEvent) {
    switch (event.type) {
      case 'agent:started':
        this.stats.totalRequests++;
        break;
      case 'model:token':
        this.stats.totalTokens++;
        break;
      case 'tool:started':
        this.stats.totalToolCalls++;
        break;
      case 'agent:error':
      case 'tool:error':
        this.stats.totalErrors++;
        break;
    }
  }

  private updateActiveAgents(event: AgentEvent) {
    const agentId = event.agentId || event.chatId || 'default';

    switch (event.type) {
      case 'agent:started':
        this.activeAgents.set(agentId, {
          id: agentId,
          chatId: event.chatId || 'default',
          startedAt: event.timestamp,
          status: 'thinking',
          agentType: 'main',
          input: event.data.input,
          tokenCount: 0,
          toolCalls: [],
        });
        break;

      case 'agent:spawned':
        this.activeAgents.set(agentId, {
          id: agentId,
          chatId: event.chatId || 'default',
          startedAt: event.timestamp,
          status: 'thinking',
          agentType: 'skill',
          skillId: event.data.skillId,
          skillName: event.data.skillName,
          parentAgentId: event.data.parentAgentId,
          input: event.data.input,
          tokenCount: 0,
          toolCalls: [],
        });
        break;

      case 'skill:started':
        const skillAgent = this.activeAgents.get(agentId);
        if (skillAgent) {
          skillAgent.status = 'thinking';
        }
        break;

      case 'model:loading':
        const loadingAgent = this.activeAgents.get(agentId);
        if (loadingAgent) {
          loadingAgent.status = 'thinking';
        }
        break;

      case 'model:inference_start':
        const inferStartAgent = this.activeAgents.get(agentId);
        if (inferStartAgent) {
          inferStartAgent.status = 'thinking';
        }
        break;

      case 'model:inference_end':
        const inferEndAgent = this.activeAgents.get(agentId);
        if (inferEndAgent) {
          inferEndAgent.status = 'streaming';
        }
        break;

      case 'agent:thinking':
        const thinkingAgent = this.activeAgents.get(agentId);
        if (thinkingAgent) {
          thinkingAgent.status = 'thinking';
        }
        break;

      case 'tool:started':
        const toolAgent = this.activeAgents.get(agentId);
        if (toolAgent) {
          toolAgent.status = 'tool_call';
          toolAgent.currentTool = event.data.toolName;
          toolAgent.toolCalls.push({
            name: event.data.toolName || 'unknown',
            startedAt: event.timestamp,
          });
        }
        break;

      case 'tool:completed':
      case 'tool:error':
        const toolDoneAgent = this.activeAgents.get(agentId);
        if (toolDoneAgent && toolDoneAgent.toolCalls.length > 0) {
          const lastTool = toolDoneAgent.toolCalls[toolDoneAgent.toolCalls.length - 1];
          lastTool.completedAt = event.timestamp;
          lastTool.success = event.type === 'tool:completed';
          toolDoneAgent.currentTool = undefined;
          toolDoneAgent.status = 'streaming';
        }
        break;

      case 'model:token':
        const tokenAgent = this.activeAgents.get(agentId);
        if (tokenAgent) {
          tokenAgent.status = 'streaming';
          tokenAgent.tokenCount++;
        }
        break;

      case 'skill:completed':
        const skillDoneAgent = this.activeAgents.get(agentId);
        if (skillDoneAgent) {
          skillDoneAgent.status = 'completed';
          setTimeout(() => this.activeAgents.delete(agentId), 3000);
        }
        break;

      case 'agent:completed':
      case 'agent:error':
        const doneAgent = this.activeAgents.get(agentId);
        if (doneAgent) {
          doneAgent.status = event.type === 'agent:completed' ? 'completed' : 'error';
          setTimeout(() => this.activeAgents.delete(agentId), 5000);
        }
        break;
    }
  }

  getRecentEvents(limit: number = 100): AgentEvent[] {
    return this.events.slice(-limit);
  }

  getActiveAgents(): ActiveAgent[] {
    return Array.from(this.activeAgents.values());
  }

  getAgentTree(): { main: ActiveAgent[]; skills: Map<string, ActiveAgent[]> } {
    const main: ActiveAgent[] = [];
    const skills = new Map<string, ActiveAgent[]>();

    for (const agent of this.activeAgents.values()) {
      if (agent.agentType === 'main') {
        main.push(agent);
      } else if (agent.parentAgentId) {
        const children = skills.get(agent.parentAgentId) || [];
        children.push(agent);
        skills.set(agent.parentAgentId, children);
      }
    }

    return { main, skills };
  }

  getStats() {
    const agents = this.getActiveAgents();
    const mainAgents = agents.filter(a => a.agentType === 'main' || !a.agentType).length;
    const skillAgents = agents.filter(a => a.agentType === 'skill').length;

    return {
      ...this.stats,
      uptimeMs: Date.now() - this.stats.startTime,
      activeAgentCount: this.activeAgents.size,
      mainAgentCount: mainAgents,
      skillAgentCount: skillAgents,
      eventsInBuffer: this.events.length,
    };
  }

  log(level: 'info' | 'warn' | 'error' | 'debug', message: string, extra?: any) {
    this.emit('system:log', { level, message, ...extra });
    const prefix = `[Admin:${level.toUpperCase()}]`;
    if (level === 'error') console.error(prefix, message, extra || '');
    else if (level === 'warn') console.warn(prefix, message, extra || '');
    else console.log(prefix, message, extra || '');
  }
}

export const agentEvents = new AgentEventEmitter();
