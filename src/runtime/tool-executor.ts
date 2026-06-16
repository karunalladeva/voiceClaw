import { formatMissingToolArgs } from '../utils/soften-tool-schema';
import { getAgentRunContext, getAgentRunStorage } from '../agents/agent-run-context';
import { getRunContext, getRunContextStorage } from '../platform/session/run-context-storage';
import type { Message, ToolCall } from './messages';
import { toolMessage, messageContentToString } from './messages';
import type { ToolDefinition } from './tools';
import { z } from 'zod';

function isToolArgErrorContent(text: string): boolean {
  return (
    text.includes('did not match expected schema') ||
    text.includes('without required arguments') ||
    text.includes('Please fix your mistakes')
  );
}

export function countRepeatedToolArgErrors(messages: Message[], toolName: string): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'tool' || msg.name !== toolName) break;
    if (isToolArgErrorContent(messageContentToString(msg.content))) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function toolResultForInvalidCall(tc: ToolCall): Message {
  const args = tc.args ?? {};
  const emptyArgs = Object.keys(args).length === 0;
  const missing = emptyArgs
    ? ['required arguments']
    : Object.entries(args)
        .filter(([, v]) => v === undefined || v === null || (typeof v === 'string' && !v.trim()))
        .map(([k]) => k);
  return toolMessage(
    tc.id,
    tc.name,
    formatMissingToolArgs(tc.name, missing.length > 0 ? missing : ['required arguments']),
  );
}

function toolResultForRetryLimit(tc: ToolCall, attempts: number): Message {
  return toolMessage(
    tc.id,
    tc.name,
    `Stopped retrying ${tc.name}: invalid or empty args ${attempts} times in a row. ` +
      `Respond in plain text with what you intended, or call a different tool with complete JSON arguments.`,
  );
}

function toolResultForUnknownTool(tc: ToolCall, available: string[]): Message {
  const skillHint =
    tc.name === 'web_search' || tc.name === 'web_fetch'
      ? ' Use route_to_skill with a research skill, or read_file on upstream artifact paths.'
      : ' Use route_to_skill for skills listed in your allowed capabilities.';
  return toolMessage(
    tc.id,
    tc.name,
    `Error: Tool "${tc.name}" is not available in this org run. ` +
      `Available tools: ${available.join(', ')}.${skillHint}`,
  );
}

function getRequiredKeys(shape: Record<string, z.ZodTypeAny>): string[] {
  return Object.entries(shape)
    .filter(([, field]) => !field.isOptional())
    .map(([key]) => key);
}

function isMissingValue(value: unknown, fieldName: string): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && fieldName !== 'content' && fieldName !== 'contentBase64' && !value.trim()) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

async function executeOneTool(
  tool: ToolDefinition,
  tc: ToolCall,
): Promise<Message> {
  const args = tc.args ?? {};
  if (tool.schema instanceof z.ZodObject) {
    const requiredKeys = getRequiredKeys(tool.schema.shape as Record<string, z.ZodTypeAny>);
    const missing = requiredKeys.filter((k) => isMissingValue(args[k], k));
    if (missing.length > 0) {
      return toolResultForInvalidCall(tc);
    }
  }
  try {
    const parsed = tool.schema.parse(args);
    const result = await tool.execute(parsed as Record<string, unknown>);
    return toolMessage(tc.id, tc.name, result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes('did not match expected schema') ||
      message.includes('ToolInputParsingException')
    ) {
      return toolResultForInvalidCall(tc);
    }
    return toolMessage(tc.id, tc.name, `Error executing ${tc.name}: ${message}`);
  }
}

async function runWithAls<T>(fn: () => Promise<T>): Promise<T> {
  const agentCtx = getAgentRunContext();
  const platformCtx = getRunContext();
  if (agentCtx && platformCtx) {
    const agentStorage = getAgentRunStorage();
    const platformStorage = getRunContextStorage();
    return agentStorage.run(agentCtx, () => platformStorage.run(platformCtx, fn));
  }
  if (agentCtx) {
    return getAgentRunStorage().run(agentCtx, fn);
  }
  if (platformCtx) {
    return getRunContextStorage().run(platformCtx, fn);
  }
  return fn();
}

export async function executeToolCalls(
  tools: ToolDefinition[],
  messages: Message[],
  toolCalls: ToolCall[],
): Promise<Message[]> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const available = [...toolMap.keys()].sort();
  const results: Message[] = [];
  let allLocal = true;
  for (const tc of toolCalls) {
    const tool = toolMap.get(tc.name);
    if (!tool) {
      results.push(toolResultForUnknownTool(tc, available));
      continue;
    }
    const priorErrors = countRepeatedToolArgErrors(messages, tc.name);
    if (priorErrors >= 2) {
      results.push(toolResultForRetryLimit(tc, priorErrors + 1));
      continue;
    }
    const args = tc.args ?? {};
    if (Object.keys(args).length === 0) {
      results.push(toolResultForInvalidCall(tc));
      continue;
    }
    allLocal = false;
  }
  if (allLocal && results.length === toolCalls.length) {
    return results;
  }
  const executed: Message[] = [...results];
  const pending = toolCalls.filter(
    (tc) => !results.some((r) => r.toolCallId === tc.id),
  );
  for (const tc of pending) {
    const tool = toolMap.get(tc.name)!;
    const msg = await runWithAls(() => executeOneTool(tool, tc));
    executed.push(msg);
  }
  return executed;
}
