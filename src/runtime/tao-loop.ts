import type { LlmClient } from '../llm/types';
import type { Message, ToolCall } from './messages';
import { assistantMessage, messageContentToString } from './messages';
import type { ToolDefinition } from './tools';
import { prepareMessagesForModel } from './message-trim';
import { executeToolCalls } from './tool-executor';
import { processToolResultMessages } from './tool-output';
import { shouldEndAfterObserve, shouldEndAfterThink } from './loop-policy';
import { invokeWithToolXmlFallback } from '../llm/invoke-with-fallback';

export const DEFAULT_TAO_MAX_TURNS = 100;

export interface TaoLoopOptions {
  client: LlmClient;
  plainClient?: LlmClient;
  tools: ToolDefinition[];
  messages: Message[];
  maxTurns?: number;
  signal?: AbortSignal;
  label?: string;
  scopeId?: string;
  orgTaskId?: string;
  modelId?: string;
}

export interface TaoLoopResult {
  messages: Message[];
  finalText: string;
  endedReason: 'final_text' | 'skill_handoff' | 'max_turns';
}

export type TaoStreamEvent =
  | { type: 'thinking'; data: string }
  | { type: 'token'; data: string }
  | { type: 'tool_call'; data: string }
  | { type: 'tool_result'; data: { name: string; output: string } }
  | { type: 'done'; data: TaoLoopResult }
  | { type: 'error'; data: string };

async function think(
  client: LlmClient,
  plainClient: LlmClient | undefined,
  messages: Message[],
  tools: ToolDefinition[],
  meta: { label?: string; signal?: AbortSignal; modelId?: string },
): Promise<{ content: string; toolCalls?: ToolCall[] }> {
  const trimmed = prepareMessagesForModel(messages);
  if (plainClient && tools.length > 0) {
    return invokeWithToolXmlFallback(client, plainClient, trimmed, tools, meta);
  }
  return client.complete({
    messages: trimmed,
    tools: tools.length > 0 ? tools : undefined,
    signal: meta.signal,
    label: meta.label,
  });
}

export async function runTaoLoop(options: TaoLoopOptions): Promise<TaoLoopResult> {
  const messages = [...options.messages];
  const maxTurns = options.maxTurns ?? DEFAULT_TAO_MAX_TURNS;
  let finalText = '';
  let endedReason: TaoLoopResult['endedReason'] = 'max_turns';
  for (let turn = 0; turn < maxTurns; turn++) {
    if (options.signal?.aborted) break;
    const response = await think(
      options.client,
      options.plainClient,
      messages,
      options.tools,
      {
        label: options.label,
        signal: options.signal,
        modelId: options.modelId,
      },
    );
    finalText = response.content;
    messages.push(assistantMessage(response.content, response.toolCalls));
    const thinkEnd = shouldEndAfterThink(response.content, response.toolCalls, {
      orgTaskId: options.orgTaskId,
    });
    if (thinkEnd.end) {
      endedReason = thinkEnd.reason ?? 'final_text';
      break;
    }
    const toolCalls = response.toolCalls ?? [];
    const rawResults = await executeToolCalls(options.tools, messages, toolCalls);
    const scopeId = options.scopeId ?? 'default';
    const processed = await processToolResultMessages(
      rawResults.map((m) => ({
        toolCallId: m.toolCallId ?? '',
        name: m.name ?? 'tool',
        content: messageContentToString(m.content),
      })),
      scopeId,
    );
    messages.push(...processed);
    const lastTool = processed[processed.length - 1];
    const observeEnd = shouldEndAfterObserve(lastTool, { orgTaskId: options.orgTaskId });
    if (observeEnd.end) {
      endedReason = observeEnd.reason ?? 'skill_handoff';
      if (lastTool) {
        finalText = messageContentToString(lastTool.content);
      }
      break;
    }
  }
  return { messages, finalText, endedReason };
}

export async function* streamTaoLoop(options: TaoLoopOptions): AsyncGenerator<TaoStreamEvent> {
  yield { type: 'thinking', data: 'Processing…' };
  const messages = [...options.messages];
  const maxTurns = options.maxTurns ?? DEFAULT_TAO_MAX_TURNS;
  let finalText = '';
  let endedReason: TaoLoopResult['endedReason'] = 'max_turns';
  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      if (options.signal?.aborted) break;
      const response = await think(
        options.client,
        options.plainClient,
        messages,
        options.tools,
        {
          label: options.label,
          signal: options.signal,
          modelId: options.modelId,
        },
      );
      if (response.content) {
        finalText = response.content;
        yield { type: 'token', data: response.content };
      }
      messages.push(assistantMessage(response.content, response.toolCalls));
      const thinkEnd = shouldEndAfterThink(response.content, response.toolCalls, {
        orgTaskId: options.orgTaskId,
      });
      if (thinkEnd.end) {
        endedReason = thinkEnd.reason ?? 'final_text';
        break;
      }
      for (const tc of response.toolCalls ?? []) {
        yield { type: 'tool_call', data: tc.name };
      }
      const rawResults = await executeToolCalls(options.tools, messages, response.toolCalls ?? []);
      const scopeId = options.scopeId ?? 'default';
      const processed = await processToolResultMessages(
        rawResults.map((m) => ({
          toolCallId: m.toolCallId ?? '',
          name: m.name ?? 'tool',
          content: messageContentToString(m.content),
        })),
        scopeId,
      );
      for (const m of processed) {
        yield {
          type: 'tool_result',
          data: { name: m.name ?? 'tool', output: messageContentToString(m.content).slice(0, 200) },
        };
      }
      messages.push(...processed);
      const lastTool = processed[processed.length - 1];
      const observeEnd = shouldEndAfterObserve(lastTool, { orgTaskId: options.orgTaskId });
      if (observeEnd.end) {
        endedReason = observeEnd.reason ?? 'skill_handoff';
        if (lastTool) {
          finalText = messageContentToString(lastTool.content);
        }
        break;
      }
    }
    yield { type: 'done', data: { messages, finalText, endedReason } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', data: message };
  }
}
