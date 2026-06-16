import type { LlmClient, LlmCompleteResponse } from './types';
import type { Message } from '../runtime/messages';
import { userMessage } from '../runtime/messages';
import type { ToolDefinition } from '../runtime/tools';
import { debugLogLlmRequest, debugLogLlmResponse } from '../utils/debug-logger';
import {
  isOllamaToolCallParseError,
  isOllamaXmlToolCallError,
  ollamaToolCallRetryMessages,
} from './ollama-tool-errors';

export async function invokeWithToolXmlFallback(
  clientWithTools: LlmClient,
  plainClient: LlmClient,
  messages: Message[],
  tools: ToolDefinition[],
  meta?: { label?: string; signal?: AbortSignal; modelId?: string },
): Promise<LlmCompleteResponse> {
  const label = meta?.label ?? 'agent-turn';
  try {
    debugLogLlmRequest(label, messages, meta?.modelId);
    const response = await clientWithTools.complete({
      messages,
      tools,
      signal: meta?.signal,
      label,
    });
    debugLogLlmResponse(label, response, meta?.modelId);
    return response;
  } catch (err) {
    if (isOllamaToolCallParseError(err) && !isOllamaXmlToolCallError(err)) {
      console.warn('[LLM] Ollama JSON tool-call parse error — retrying with encoding hints');
      try {
        const retryMessages = ollamaToolCallRetryMessages(messages);
        debugLogLlmRequest(`${label}:json-retry`, retryMessages, meta?.modelId);
        const response = await clientWithTools.complete({
          messages: retryMessages,
          tools,
          signal: meta?.signal,
          label: `${label}:json-retry`,
        });
        debugLogLlmResponse(`${label}:json-retry`, response, meta?.modelId);
        return response;
      } catch (retryErr) {
        if (!isOllamaToolCallParseError(retryErr)) throw retryErr;
        err = retryErr;
      }
    }
    if (isOllamaXmlToolCallError(err)) {
      console.warn('[LLM] Ollama XML tool-call parse error — retrying once without tools');
      const fallbackMessages = [
        ...messages,
        userMessage(
          'Your previous tool-call XML was malformed. Respond in plain text only for this turn.',
        ),
      ];
      debugLogLlmRequest(`${label}:xml-fallback`, fallbackMessages, meta?.modelId);
      const response = await plainClient.complete({
        messages: fallbackMessages,
        signal: meta?.signal,
        label: `${label}:xml-fallback`,
      });
      debugLogLlmResponse(`${label}:xml-fallback`, response, meta?.modelId);
      return response;
    }
    if (isOllamaToolCallParseError(err)) {
      console.warn('[LLM] Ollama tool-call parse error — retrying once without tools');
      const fallbackMessages = [
        ...messages,
        userMessage(
          'Your tool call could not be parsed. Respond in plain text only for this turn, or retry on the next heartbeat.',
        ),
      ];
      debugLogLlmRequest(`${label}:parse-fallback`, fallbackMessages, meta?.modelId);
      const response = await plainClient.complete({
        messages: fallbackMessages,
        signal: meta?.signal,
        label: `${label}:parse-fallback`,
      });
      debugLogLlmResponse(`${label}:parse-fallback`, response, meta?.modelId);
      return response;
    }
    throw err;
  }
}
