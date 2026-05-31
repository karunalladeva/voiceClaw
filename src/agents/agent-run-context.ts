import { AsyncLocalStorage } from 'node:async_hooks';

export interface AgentRunContext {
  orgTaskId: string;
  orgRootTaskId: string;
  orgAgentId?: string;
}

const storage = new AsyncLocalStorage<AgentRunContext>();

export function getAgentRunContext(): AgentRunContext | undefined {
  return storage.getStore();
}

export function getAgentRunStorage(): AsyncLocalStorage<AgentRunContext> {
  return storage;
}

export function toTaskArtifactScope(ctx: AgentRunContext): { id: string; rootTaskId: string } {
  return { id: ctx.orgTaskId, rootTaskId: ctx.orgRootTaskId };
}
