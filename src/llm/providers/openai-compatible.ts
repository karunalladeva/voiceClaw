import type { ModelConfig } from '../../models/types';
import type { LlmClient, LlmCompleteRequest, LlmCompleteResponse } from '../types';
import { messagesToOpenAi, parseOpenAiAssistantMessage } from '../message-format';
import { toolsToLlmSchemas } from '../../runtime/tools';
import { debugLogLlmRequest, debugLogLlmResponse } from '../../utils/debug-logger';

function buildAuthHeaders(auth?: ModelConfig['auth']): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth?.apiKey) headers['Authorization'] = `Bearer ${auth.apiKey}`;
  if (auth?.bearer) headers['Authorization'] = `Bearer ${auth.bearer}`;
  if (auth?.customHeaders) Object.assign(headers, auth.customHeaders);
  return headers;
}

export function createOpenAiCompatibleClient(
  config: ModelConfig,
  defaultBaseUrl?: string,
): LlmClient {
  const baseUrl = (config.baseUrl || defaultBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = config.auth?.apiKey || config.auth?.bearer || 'no-key';

  return {
    modelId: config.id,
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResponse> {
      const label = req.label ?? 'openai-compatible';
      debugLogLlmRequest(label, req.messages, config.id);
      const body: Record<string, unknown> = {
        model: config.model,
        messages: messagesToOpenAi(req.messages),
        stream: false,
      };
      if (req.tools?.length) {
        body.tools = toolsToLlmSchemas(req.tools);
        body.tool_choice = 'auto';
      }
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildAuthHeaders({ ...config.auth, apiKey }),
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Chat completion failed (${res.status}): ${text.slice(0, 500)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown[] } }>;
      };
      const message = data.choices?.[0]?.message ?? {};
      const parsed = parseOpenAiAssistantMessage(
        message as Parameters<typeof parseOpenAiAssistantMessage>[0],
      );
      debugLogLlmResponse(label, parsed, config.id);
      return parsed;
    },
  };
}
