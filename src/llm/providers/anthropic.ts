import type { Message, ToolCall } from '../../runtime/messages';
import { messageContentToString } from '../../runtime/messages';
import type { ModelConfig } from '../../models/types';
import type { LlmClient, LlmCompleteRequest, LlmCompleteResponse } from '../types';
import { debugLogLlmRequest, debugLogLlmResponse } from '../../utils/debug-logger';

function toAnthropicMessages(messages: Message[]): {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
} {
  let system: string | undefined;
  const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      system = messageContentToString(msg.content);
      continue;
    }
    if (msg.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.toolCallId ?? '',
            content: messageContentToString(msg.content),
          },
        ],
      });
      continue;
    }
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      const blocks: unknown[] = [];
      const text = messageContentToString(msg.content);
      if (text) blocks.push({ type: 'text', text });
      for (const tc of msg.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.args,
        });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    out.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: messageContentToString(msg.content),
    });
  }
  return { system, messages: out };
}

export function createAnthropicClient(config: ModelConfig): LlmClient {
  const baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
  return {
    modelId: config.id,
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResponse> {
      const label = req.label ?? 'anthropic';
      debugLogLlmRequest(label, req.messages, config.id);
      const { system, messages } = toAnthropicMessages(req.messages);
      const body: Record<string, unknown> = {
        model: config.model,
        max_tokens: 8192,
        messages,
      };
      if (system) body.system = system;
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: { type: 'object', properties: {} },
        }));
      }
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.auth?.apiKey ?? '',
          'anthropic-version': '2023-06-01',
          ...(config.auth?.customHeaders ?? {}),
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic failed (${res.status}): ${text.slice(0, 500)}`);
      }
      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      };
      let content = '';
      const toolCalls: ToolCall[] = [];
      for (const block of data.content ?? []) {
        if (block.type === 'text' && block.text) content += block.text;
        if (block.type === 'tool_use' && block.id && block.name) {
          toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
        }
      }
      const parsed = { content, toolCalls: toolCalls.length ? toolCalls : undefined };
      debugLogLlmResponse(label, parsed, config.id);
      return parsed;
    },
  };
}
