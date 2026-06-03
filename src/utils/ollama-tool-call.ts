import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';

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
): Promise<BaseMessage> {
  try {
    return (await llmWithTools.invoke(messages)) as BaseMessage;
  } catch (err) {
    if (!isOllamaXmlToolCallError(err)) throw err;
    console.warn(
      '[LLM] Ollama XML tool-call parse error — retrying once without tools',
    );
    return (await llmPlain.invoke([
      ...messages,
      new HumanMessage(
        'Your previous tool-call XML was malformed. Respond in plain text only for this turn. ' +
          'Summarize using context already in the thread; do not emit tool calls.',
      ),
    ])) as BaseMessage;
  }
}
