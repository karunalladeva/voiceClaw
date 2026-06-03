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

function truncateAtLineBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastBreak = slice.lastIndexOf('\n');
  if (lastBreak > maxChars * 0.5) {
    return slice.slice(0, lastBreak).trimEnd() + TRUNCATION_SUFFIX;
  }
  return slice.trimEnd() + TRUNCATION_SUFFIX;
}

/** Truncate a single tool result string for LLM context limits. */
export function truncateToolOutput(
  content: unknown,
  maxChars: number = DEFAULT_TOOL_OUTPUT_MAX_CHARS,
): string {
  const text = normalizeToolContent(content);
  return truncateAtLineBoundary(text, maxChars);
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
