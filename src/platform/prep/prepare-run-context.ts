import type { AgentRunOptions } from '../../agents/agent-run-options';
import type { ReadAllowlistResult } from '../../orchestration/artifact-read-allowlist';
import type { RunContext, RunChannel } from '../contracts';
import { buildChatScopeId, buildOrgScopeId } from '../session/scope-id';
import { sessionRuntime } from '../session/session-runtime';

export interface PrepareRunContextInput {
  channel: RunChannel;
  sessionId?: string;
  chatId?: string;
  orgOptions?: AgentRunOptions;
}

export interface PreparedRun {
  runContext: RunContext;
  chatId: string;
}

export async function prepareRunContext(input: PrepareRunContextInput): Promise<PreparedRun> {
  if (input.orgOptions?.orgTaskId) {
    const rootTaskId = input.orgOptions.orgRootTaskId ?? input.orgOptions.orgTaskId;
    const scopeId = buildOrgScopeId(rootTaskId, input.orgOptions.orgTaskId);
    const sessionId = input.sessionId ?? `org-${input.orgOptions.orgTaskId}`;
    const runContext: RunContext = {
      sessionId,
      scopeId,
      channel: 'org',
      orgTaskId: input.orgOptions.orgTaskId,
      rootTaskId,
      allowedReadPaths: input.orgOptions.allowedReadPaths as ReadAllowlistResult | undefined,
    };
    return { runContext, chatId: input.chatId ?? sessionId };
  }
  let sessionId = input.sessionId?.trim();
  let chatId = input.chatId?.trim();
  if (sessionId) {
    const row = await sessionRuntime.resolveSession(sessionId);
    if (!row) throw new Error('Invalid sessionId');
    chatId = row.chatId;
  } else {
    throw new Error('sessionId is required');
  }
  const runContext: RunContext = {
    sessionId,
    scopeId: buildChatScopeId(chatId!),
    channel: input.channel,
    chatId,
  };
  return { runContext, chatId: chatId! };
}

export async function createChatSessionRecord(chatId?: string): Promise<{ sessionId: string; chatId: string }> {
  const row = await sessionRuntime.createChatSession(chatId);
  return { sessionId: row.sessionId, chatId: row.chatId };
}
