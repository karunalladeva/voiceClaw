export const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 8000;

const TRUNCATION_SUFFIX = '\n\n...[TRUNCATED for context window]...';

function normalizeToolContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) {
    return content
      .map((block: { text?: string }) => block?.text ?? '')
      .join('');
  }
  return content.toString();
}

/** Truncate a single tool result string for LLM context limits. */
export function truncateToolOutput(
  content: unknown,
  maxChars: number = DEFAULT_TOOL_OUTPUT_MAX_CHARS,
): string {
  const text = normalizeToolContent(content);
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars) + TRUNCATION_SUFFIX;
}

/** Mutates tool messages in place after ToolNode execution. */
export function truncateToolMessages(
  messages: Array<{ content?: unknown }>,
  maxChars: number = DEFAULT_TOOL_OUTPUT_MAX_CHARS,
): void {
  for (const msg of messages) {
    if (msg.content == null) continue;
    const text = normalizeToolContent(msg.content);
    if (text.length <= maxChars) continue;
    msg.content = truncateToolOutput(text, maxChars);
  }
}
