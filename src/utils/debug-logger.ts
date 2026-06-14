import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage } from '@langchain/core/messages';
import { configManager } from '../config/index';
import { agentEvents } from '../admin/agent-events';

const LLM_PREVIEW_CHARS = 800;
const LLM_EVENT_CHARS = 3000;

interface LlmLogEntry {
  role: string;
  content: string;
  toolCalls?: string;
}

function messageToLogEntry(msg: BaseMessage): LlmLogEntry {
  const role = typeof msg.getType === 'function' ? msg.getType() : msg.constructor?.name ?? 'unknown';
  let content = '';
  if (typeof msg.content === 'string') {
    content = msg.content;
  } else if (Array.isArray(msg.content)) {
    content = msg.content
      .map((block: { text?: string; type?: string }) => {
        if (block?.text) return block.text;
        if (block?.type === 'image_url') return '[image]';
        return JSON.stringify(block);
      })
      .join('\n');
  } else if (msg.content != null) {
    content = String(msg.content);
  }
  const entry: LlmLogEntry = { role, content };
  const toolCalls = (msg as { tool_calls?: unknown[] }).tool_calls;
  if (toolCalls?.length) {
    entry.toolCalls = JSON.stringify(toolCalls, null, 2);
  }
  return entry;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [${text.length} chars total]`;
}

export function isDebugLoggingEnabled(): boolean {
  const cfg = configManager.getConfig().debug;
  if (cfg?.enabled) return true;
  const env = process.env.DEBUG?.trim().toLowerCase();
  return env === '1' || env === 'true' || env === 'yes';
}

export function isLlmIoDebugEnabled(): boolean {
  const cfg = configManager.getConfig().debug;
  if (cfg?.enabled && cfg?.logLlmIo) return true;
  const env = process.env.DEBUG_PROMPT?.trim().toLowerCase();
  return env === '1' || env === 'true' || env === 'yes';
}

export function debugLog(category: string, message: string, extra?: Record<string, unknown>): void {
  if (!isDebugLoggingEnabled()) return;
  const line = `[Debug:${category}] ${message}`;
  console.log(line, extra ?? '');
  agentEvents.emit('system:log', { level: 'debug', message: line, ...extra });
}

export function debugLogLlmRequest(label: string, messages: BaseMessage[], modelId?: string): void {
  if (!isLlmIoDebugEnabled()) return;
  const entries = messages.map(messageToLogEntry);
  const preview = entries
    .map((entry) => {
      const body = truncate(entry.content, LLM_PREVIEW_CHARS);
      const tools = entry.toolCalls ? `\n    tool_calls: ${entry.toolCalls}` : '';
      return `  [${entry.role}] ${body}${tools}`;
    })
    .join('\n');
  const header = `[Debug:LLM:IN] ${label}${modelId ? ` model=${modelId}` : ''} (${messages.length} message(s))`;
  console.log(`${header}\n${preview}`);
  agentEvents.emit('debug:llm_request', {
    label,
    modelId,
    messageCount: messages.length,
    messages: entries.map((entry) => ({
      role: entry.role,
      content: truncate(entry.content, LLM_EVENT_CHARS),
      toolCalls: entry.toolCalls,
    })),
  });
}

export function debugLogLlmResponse(label: string, response: BaseMessage, modelId?: string): void {
  if (!isLlmIoDebugEnabled()) return;
  const entry = messageToLogEntry(response);
  const body = truncate(entry.content, LLM_PREVIEW_CHARS);
  const tools = entry.toolCalls ? `\n  tool_calls: ${entry.toolCalls}` : '';
  const header = `[Debug:LLM:OUT] ${label}${modelId ? ` model=${modelId}` : ''}`;
  console.log(`${header}\n  [${entry.role}] ${body}${tools}`);
  agentEvents.emit('debug:llm_response', {
    label,
    modelId,
    role: entry.role,
    content: truncate(entry.content, LLM_EVENT_CHARS),
    toolCalls: entry.toolCalls,
  });
}

export async function invokeLlmWithDebug(
  llm: BaseChatModel,
  messages: BaseMessage[],
  meta?: { label?: string; modelId?: string },
): Promise<BaseMessage> {
  const label = meta?.label ?? 'invoke';
  debugLogLlmRequest(label, messages, meta?.modelId);
  const response = (await llm.invoke(messages)) as BaseMessage;
  debugLogLlmResponse(label, response, meta?.modelId);
  return response;
}
