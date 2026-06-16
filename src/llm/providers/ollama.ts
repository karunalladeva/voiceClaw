import { createOllamaFetch } from '../../utils/ollama-fetch';
import { isOllamaFetchTimeoutError } from '../../utils/ollama-fetch';
import { warmLocalModel } from '../../models/local-model-lifecycle';
import type { ModelConfig } from '../../models/types';
import type { LlmClient, LlmCompleteRequest, LlmCompleteResponse } from '../types';
import { messagesToOpenAi, parseOllamaMessage } from '../message-format';
import { toolsToLlmSchemas } from '../../runtime/tools';
import { userMessage } from '../../runtime/messages';
import { debugLogLlmRequest, debugLogLlmResponse } from '../../utils/debug-logger';
import {
  compressToolResultsForOllama,
  isOllamaToolCallParseError,
  isOllamaXmlToolCallError,
  ollamaToolCallRetryMessages,
} from '../ollama-tool-errors';

export function createOllamaClient(config: ModelConfig): LlmClient {
  const baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  const fetchImpl = createOllamaFetch();

  async function chatOnce(
    req: LlmCompleteRequest,
    withTools: boolean,
  ): Promise<LlmCompleteResponse> {
    const ollamaMessages = compressToolResultsForOllama(req.messages);
    const body: Record<string, unknown> = {
      model: config.model,
      messages: messagesToOpenAi(ollamaMessages),
      stream: false,
      keep_alive: -1,
    };
    if (withTools && req.tools?.length) {
      body.tools = toolsToLlmSchemas(req.tools).map((t) => ({
        type: 'function',
        function: t.function,
      }));
    }
    const label = req.label ?? 'ollama';
    debugLogLlmRequest(label, req.messages, config.id);
    const res = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.auth?.customHeaders ?? {}),
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama chat failed (${res.status}): ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as Parameters<typeof parseOllamaMessage>[0];
    const parsed = parseOllamaMessage(data);
    debugLogLlmResponse(label, parsed, config.id);
    return parsed;
  }

  return {
    modelId: config.id,
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResponse> {
      const hasTools = (req.tools?.length ?? 0) > 0;
      try {
        return await chatOnce(req, hasTools);
      } catch (err) {
        if (isOllamaToolCallParseError(err) && hasTools && !isOllamaXmlToolCallError(err)) {
          console.warn('[LLM] Ollama JSON tool-call parse error — retrying with encoding hints');
          try {
            return await chatOnce(
              { ...req, messages: ollamaToolCallRetryMessages(req.messages) },
              true,
            );
          } catch (retryErr) {
            if (!isOllamaToolCallParseError(retryErr)) throw retryErr;
            err = retryErr;
          }
        }
        if (isOllamaXmlToolCallError(err) && hasTools) {
          console.warn('[LLM] Ollama XML tool-call parse error — retrying without tools');
          const fallbackMessages = [
            ...req.messages,
            userMessage(
              'Your previous tool-call XML was malformed. Respond in plain text only for this turn.',
            ),
          ];
          return chatOnce({ ...req, messages: fallbackMessages, tools: undefined }, false);
        }
        if (isOllamaToolCallParseError(err) && hasTools) {
          console.warn('[LLM] Ollama tool-call parse error — retrying without tools');
          const fallbackMessages = [
            ...req.messages,
            userMessage(
              'Your tool call could not be parsed. Respond in plain text only for this turn, or retry on the next heartbeat.',
            ),
          ];
          return chatOnce({ ...req, messages: fallbackMessages, tools: undefined }, false);
        }
        if (isOllamaFetchTimeoutError(err)) {
          console.warn(`[LLM] Ollama headers timeout for ${config.id} — warming and retrying`);
          await warmLocalModel(config, config.model, true).catch(() => {});
          return chatOnce(req, hasTools);
        }
        throw err;
      }
    },
  };
}
