import type { Message } from '../runtime/messages';
import { messageContentToString, toolMessage } from '../runtime/messages';
import { userMessage } from '../runtime/messages';

/** Ollama failed to parse tool-call JSON from model output (brace/XML issues). */
export function isOllamaToolCallParseError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /XML syntax error/i.test(msg) ||
    /element <parameter> closed by/i.test(msg) ||
    /can't find closing '\}' symbol/i.test(msg) ||
    /can't find closing "}" symbol/i.test(msg) ||
    /unexpected end of JSON input/i.test(msg) ||
    /error parsing tool call/i.test(msg) ||
    /invalid character.*after object key:value pair/i.test(msg)
  );
}

export function isOllamaXmlToolCallError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /XML syntax error/i.test(msg) || /element <parameter> closed by/i.test(msg);
}

export const OLLAMA_TOOL_CALL_RETRY_HINT =
  'Your last tool call was not parsed by Ollama (nested JSON or unescaped { } in argument strings). ' +
  'Retry with: (1) write_file using contentBase64 (not content) for JSON or brace-heavy text, ' +
  '(2) save_default_pipeline_workflow with empty args {} instead of write_file for workflow.json, ' +
  '(3) delegate_from_workflow with empty args {} to spawn subtasks. ' +
  'Prefer short scalar tool args — avoid embedding raw JSON objects in string fields.';

export function ollamaToolCallRetryMessages(messages: Message[]): Message[] {
  return [...messages, userMessage(OLLAMA_TOOL_CALL_RETRY_HINT)];
}

const OLLAMA_TOOL_CONTENT_MAX = 4000;

function summarizeWorkflowToolContent(content: string): string {
  try {
    const jsonStart = content.indexOf('{');
    const parsed = JSON.parse(jsonStart >= 0 ? content.slice(jsonStart) : content) as {
      phases?: Array<{ id?: string; title?: string }>;
    };
    const phases = parsed.phases ?? [];
    const phaseLines = phases.map((p) => `- ${p.id ?? '?'}: ${p.title ?? 'untitled'}`).join('\n');
    return (
      `[Workflow summary — full JSON omitted to keep tool calls parseable]\n` +
      `Phases (${phases.length}):\n${phaseLines || '(none)'}\n` +
      `Use save_default_pipeline_workflow or delegate_from_workflow; do not rewrite workflow.json via write_file.`
    );
  } catch {
    return content.length > OLLAMA_TOOL_CONTENT_MAX
      ? `${content.slice(0, OLLAMA_TOOL_CONTENT_MAX)}\n...[truncated]...`
      : content;
  }
}

/** Shrink large tool results so the model is less likely to echo nested JSON in the next tool call. */
export function compressToolResultsForOllama(messages: Message[]): Message[] {
  return messages.map((msg) => {
    if (msg.role !== 'tool') return msg;
    const content = messageContentToString(msg.content);
    if (content.includes('"phases"') && content.includes('"version"')) {
      return toolMessage(msg.toolCallId ?? '', msg.name ?? 'tool', summarizeWorkflowToolContent(content));
    }
    if (content.length <= OLLAMA_TOOL_CONTENT_MAX) return msg;
    return toolMessage(
      msg.toolCallId ?? '',
      msg.name ?? 'tool',
      `${content.slice(0, OLLAMA_TOOL_CONTENT_MAX)}\n\n...[tool output truncated for Ollama context]...`,
    );
  });
}
