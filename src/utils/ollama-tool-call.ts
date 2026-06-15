import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { debugLogLlmRequest, debugLogLlmResponse } from './debug-logger';
import { isOllamaFetchTimeoutError } from './ollama-fetch';
import { isLocalProvider, warmLocalModel } from '../models/local-model-lifecycle';
import { modelRegistry } from '../models/model-registry';

/** Ollama native tool XML parser failed on model output (often after large tool results). */
export function isOllamaXmlToolCallError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /XML syntax error/i.test(msg) || /element <parameter> closed by/i.test(msg);
}

/**
 * Invoke a tool-bound LLM; on Ollama XML tool-call parse errors, retry once without tools.
 */
export async function invokeWithToolXmlFallback(
  llmWithTools: BaseChatModel,
  llmPlain: BaseChatModel,
  messages: BaseMessage[],
  meta?: { label?: string; modelId?: string; signal?: AbortSignal },
): Promise<BaseMessage> {
  const label = meta?.label ?? 'agent-turn';
  const invokeOpts = meta?.signal ? { signal: meta.signal } : undefined;
  try {
    debugLogLlmRequest(label, messages, meta?.modelId);
    const response = (await llmWithTools.invoke(messages, invokeOpts)) as BaseMessage;
    debugLogLlmResponse(label, response, meta?.modelId);
    return response;
  } catch (err) {
    if (isOllamaXmlToolCallError(err)) {
      console.warn(
        '[LLM] Ollama XML tool-call parse error — retrying once without tools',
      );
      const fallbackMessages = [
        ...messages,
        new HumanMessage(
          'Your previous tool-call XML was malformed. Respond in plain text only for this turn. ' +
            'Summarize using context already in the thread; do not emit tool calls.',
        ),
      ];
      debugLogLlmRequest(`${label}:xml-fallback`, fallbackMessages, meta?.modelId);
      const response = (await llmPlain.invoke(fallbackMessages, invokeOpts)) as BaseMessage;
      debugLogLlmResponse(`${label}:xml-fallback`, response, meta?.modelId);
      return response;
    }
    if (isOllamaFetchTimeoutError(err) && meta?.modelId) {
      const config = modelRegistry.getById(meta.modelId);
      if (config && isLocalProvider(config.provider)) {
        console.warn(
          `[LLM] Ollama headers timeout for ${meta.modelId} — warming model and retrying once`,
        );
        await warmLocalModel(config, config.model, true).catch(() => {});
        debugLogLlmRequest(`${label}:timeout-retry`, messages, meta?.modelId);
        const response = (await llmWithTools.invoke(messages, invokeOpts)) as BaseMessage;
        debugLogLlmResponse(`${label}:timeout-retry`, response, meta?.modelId);
        return response;
      }
    }
    throw err;
  }
}
