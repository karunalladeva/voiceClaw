import type { ReadAllowlistResult } from '../../orchestration/artifact-read-allowlist';

export type RunChannel = 'admin' | 'flutter' | 'org' | 'api';

export interface RunContext {
  sessionId: string;
  scopeId: string;
  channel: RunChannel;
  chatId?: string;
  orgTaskId?: string;
  rootTaskId?: string;
  allowedReadPaths?: ReadAllowlistResult;
}

export interface ChatSessionRecord {
  sessionId: string;
  chatId: string;
  createdAt: string;
  lastActiveAt: string;
}
