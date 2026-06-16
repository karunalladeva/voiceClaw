import type { Message, ToolCall, ContentBlock } from '../runtime/messages';
import { messageContentToString } from '../runtime/messages';

export interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export function messagesToOpenAi(messages: Message[]): OpenAiChatMessage[] {
  const out: OpenAiChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'tool') {
      out.push({
        role: 'tool',
        content: messageContentToString(msg.content),
        tool_call_id: msg.toolCallId ?? '',
        name: msg.name,
      });
      continue;
    }
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: messageContentToString(msg.content) || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args ?? {}),
          },
        })),
      });
      continue;
    }
    const content = formatContentForOpenAi(msg.content);
    out.push({ role: msg.role, content });
  }
  return out;
}

function formatContentForOpenAi(
  content: string | ContentBlock[],
): string | OpenAiChatMessage['content'] {
  if (typeof content === 'string') return content;
  return content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'image_url') return { type: 'image_url', image_url: block.image_url };
    return { type: 'text', text: '' };
  });
}

export function parseOpenAiAssistantMessage(data: {
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
}): { content: string; toolCalls?: ToolCall[] } {
  const toolCalls: ToolCall[] = [];
  for (const tc of data.tool_calls ?? []) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
    } catch {
      args = {};
    }
    toolCalls.push({ id: tc.id, name: tc.function.name, args });
  }
  return {
    content: data.content ?? '',
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

export function parseOllamaMessage(data: {
  message?: {
    content?: string;
    tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  };
}): { content: string; toolCalls?: ToolCall[] } {
  const msg = data.message;
  if (!msg) return { content: '' };
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc, i) => ({
    id: `call_${i}_${tc.function.name}`,
    name: tc.function.name,
    args: tc.function.arguments ?? {},
  }));
  return {
    content: msg.content ?? '',
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
