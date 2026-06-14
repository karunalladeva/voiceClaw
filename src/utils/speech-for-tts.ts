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
const SPOKEN_OPEN_TAG = '<spoken_summary>';
const SPOKEN_CLOSE_TAG = '</spoken_summary>';
const SPOKEN_OPEN_RE = /<spoken_summary>/i;
const SPOKEN_CLOSE_RE = /<\/spoken_summary>/i;

export function removeSpokenSummaryBlock(raw: string): string {
  return raw.replace(/<spoken_summary>[\s\S]*?<\/spoken_summary>/gi, '').trim();
}

/** Hold back a suffix that may be the start of an XML tag split across chunks. */
function splitPartialTagSuffix(text: string, tag: string): { safe: string; carry: string } {
  const lowerText = text.toLowerCase();
  const lowerTag = tag.toLowerCase();
  for (let len = Math.min(text.length, lowerTag.length - 1); len >= 1; len--) {
    const suffix = lowerText.slice(-len);
    if (lowerTag.startsWith(suffix) && suffix.startsWith('<')) {
      return { safe: text.slice(0, text.length - len), carry: text.slice(text.length - len) };
    }
  }
  return { safe: text, carry: '' };
}

/** Strip <spoken_summary> from streamed tokens so the block never appears in chat UI. */
export class SpokenSummaryDisplayFilter {
  private inBlock = false;
  private carry = '';

  reset(): void {
    this.inBlock = false;
    this.carry = '';
  }

  feed(chunk: string): string {
    if (!chunk) return '';
    let work = this.carry + chunk;
    this.carry = '';
    let out = '';

    while (work.length > 0) {
      if (this.inBlock) {
        const closeMatch = work.match(SPOKEN_CLOSE_RE);
        if (closeMatch && closeMatch.index !== undefined) {
          work = work.slice(closeMatch.index + closeMatch[0].length);
          this.inBlock = false;
          continue;
        }
        const partial = splitPartialTagSuffix(work, SPOKEN_CLOSE_TAG);
        this.carry = partial.carry;
        break;
      }

      const openMatch = work.match(SPOKEN_OPEN_RE);
      if (openMatch && openMatch.index !== undefined) {
        out += work.slice(0, openMatch.index);
        work = work.slice(openMatch.index + openMatch[0].length);
        this.inBlock = true;
        continue;
      }

      const partial = splitPartialTagSuffix(work, SPOKEN_OPEN_TAG);
      out += partial.safe;
      this.carry = partial.carry;
      break;
    }

    return out;
  }
}

export function sanitizeAgentTextForDisplay(raw: string): string {
  return removeSpokenSummaryBlock(raw);
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

/** Split capped plain text into sentence chunks for faster time-to-first-audio. */
export function splitIntoTtsChunks(plain: string, maxChunkChars: number = 220): string[] {
  const trimmed = plain.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChunkChars) return [trimmed];
  const parts = trimmed.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [trimmed];
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    const next = current ? `${current} ${part.trim()}` : part.trim();
    if (next.length > maxChunkChars && current) {
      chunks.push(current.trim());
      current = part.trim();
    } else {
      current = next;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [trimmed];
}
