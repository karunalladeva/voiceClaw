import { AsyncLocalStorage } from 'node:async_hooks';
import type { ReadAllowlistResult } from '../orchestration/artifact-read-allowlist';

export interface AgentRunContext {
  orgTaskId: string;
  orgRootTaskId: string;
  orgAgentId?: string;
  /** Dedupe web_search within one org task run. */
  webSearchKeys?: Set<string>;
  /** Dedupe web_fetch by url|part|focus|query within one org task run. */
  webFetchKeys?: Set<string>;
  /** Latest user/task message for BM25 fetch ranking. */
  lastUserQuery?: string;
  /** Latest web_search query for BM25 fetch ranking. */
  lastWebSearchQuery?: string;
  /** Set when skill stream ends early — in-flight tools should no-op. */
  skillRunCancelled?: boolean;
  /** Skills that must not be re-routed on this task (incomplete prior run). */
  blockedSkillIds?: Set<string>;
  /** Pipeline-mode read allowlist (absolute paths). */
  allowedReadPaths?: ReadAllowlistResult;
  /** Manager with direct reports on this heartbeat. */
  isManagerRun?: boolean;
  /** Root has pipeline-mode label. */
  pipelineMode?: boolean;
  /** Task has unsatisfied blockedBy dependencies. */
  blockersOpen?: boolean;
  /** User decision recorded — block research fallback skills. */
  userDecisionBound?: boolean;
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
