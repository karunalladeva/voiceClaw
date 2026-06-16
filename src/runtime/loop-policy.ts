import { getAgentRunContext } from '../agents/agent-run-context';
import type { Message } from './messages';
import { messageContentToString } from './messages';

export interface LoopEndDecision {
  end: boolean;
  reason?: 'final_text' | 'skill_handoff' | 'max_turns';
}

export function shouldEndAfterThink(
  assistantContent: string,
  toolCalls: { name: string }[] | undefined,
  options?: { orgTaskId?: string },
): LoopEndDecision {
  if (!toolCalls?.length) {
    return { end: true, reason: 'final_text' };
  }
  if (
    options?.orgTaskId &&
    toolCalls.some((tc) => tc.name === 'route_to_skill')
  ) {
    return { end: false, reason: undefined };
  }
  return { end: false };
}

export function shouldEndAfterObserve(
  lastToolMessage: Message | undefined,
  options?: { orgTaskId?: string },
): LoopEndDecision {
  if (!lastToolMessage || lastToolMessage.role !== 'tool') {
    return { end: false };
  }
  const content = messageContentToString(lastToolMessage.content);
  const orgTaskId = options?.orgTaskId ?? getAgentRunContext()?.orgTaskId;
  if (
    orgTaskId &&
    lastToolMessage.name === 'route_to_skill' &&
    content.includes('[Sub-Agent Result from')
  ) {
    return { end: true, reason: 'skill_handoff' };
  }
  return { end: false };
}
