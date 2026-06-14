import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { debugLogLlmRequest, debugLogLlmResponse } from './debug-logger';

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
  meta?: { label?: string; modelId?: string },
): Promise<BaseMessage> {
  const label = meta?.label ?? 'agent-turn';
  try {
    debugLogLlmRequest(label, messages, meta?.modelId);
    const response = (await llmWithTools.invoke(messages)) as BaseMessage;
    debugLogLlmResponse(label, response, meta?.modelId);
    return response;
  } catch (err) {
    if (!isOllamaXmlToolCallError(err)) throw err;
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
    const response = (await llmPlain.invoke(fallbackMessages)) as BaseMessage;
    debugLogLlmResponse(`${label}:xml-fallback`, response, meta?.modelId);
    return response;
  }
}
