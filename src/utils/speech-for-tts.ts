/**
 * Select plain text for a single final TTS pass: prefer model-provided
 * <spoken_summary>...</spoken_summary> when the answer is long; otherwise full body.
 */

export interface SpeechForTtsConfig {
  longTextThresholdChars: number;
  minimalSummaryEnabled: boolean;
  fallbackMaxChars: number;
  truncationSuffix: string;
}

const DEFAULT_SPEECH: SpeechForTtsConfig = {
  longTextThresholdChars: 1200,
  minimalSummaryEnabled: true,
  fallbackMaxChars: 500,
  truncationSuffix: "I've placed the rest of the details on your screen.",
};

export function extractMinimalSpokenSummary(raw: string): string | null {
  const match = raw.match(/<spoken_summary>\s*([\s\S]*?)\s*<\/spoken_summary>/i);
  if (!match) return null;
  const inner = match[1].trim();
  return inner.length > 0 ? inner : null;
}

/** Strip markdown for TTS (same rules as server). */
export function stripMarkdownForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' [Code provided on screen.] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[(.+?)\]\(.*?\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^-{3,}$/gm, '')
    .replace(/>{1,}\s?/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Plain text body without the spoken_summary block (for optional display logic).
 */
export function removeSpokenSummaryBlock(raw: string): string {
  return raw.replace(/<spoken_summary>[\s\S]*?<\/spoken_summary>/gi, '').trim();
}

export function selectPlainTextForTts(
  rawFullAnswer: string,
  partial?: Partial<SpeechForTtsConfig>,
): string {
  const cfg = { ...DEFAULT_SPEECH, ...partial };
  const plainFull = stripMarkdownForSpeech(rawFullAnswer);
  if (!plainFull) {
    return "I've displayed the information on your screen.";
  }
  const extracted = extractMinimalSpokenSummary(rawFullAnswer);
  const plainExtracted = extracted ? stripMarkdownForSpeech(extracted) : '';
  const isLong = plainFull.length > cfg.longTextThresholdChars;
  if (cfg.minimalSummaryEnabled && isLong && plainExtracted.length > 0) {
    return plainExtracted;
  }
  return plainFull;
}

/** Trim to max chars at sentence boundary; append suffix if truncated. */
export function capSpeechPlain(plain: string, maxChars: number, suffix: string): string {
  if (plain.length <= maxChars) return plain;
  const slice = plain.substring(0, maxChars);
  const lastBreak = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('.\n'),
  );
  const truncated = lastBreak > 80 ? slice.substring(0, lastBreak + 1).trim() : slice.trim();
  return `${truncated} ${suffix}`.trim();
}
