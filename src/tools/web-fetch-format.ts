/**
 * Universal formatting for web_fetch — same layout for every URL (articles, docs, stores, etc.).
 */

const MAX_CONTENT_LINES = 120;
const MIN_LINE_LENGTH = 2;
const MAX_LINE_LENGTH = 600;

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** HTML → readable plain text with paragraph/heading line breaks (any site). */
export function htmlToReadableText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, ' ').trim()) : '';

  text = text
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|br|section|article|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<h([1-6])[^>]*>/gi, (_, level) => `\n${'#'.repeat(Math.min(Number(level), 4))} `)
    .replace(/<[^>]+>/g, ' ');

  const body = normalizePlainText(decodeHtmlEntities(text));
  if (pageTitle && !body.toLowerCase().startsWith(pageTitle.toLowerCase().slice(0, 20))) {
    return `# ${pageTitle}\n\n${body}`;
  }
  return body;
}

/** Normalize any plain text blob (HTTP body, innerText, etc.). */
export function normalizePlainText(text: string): string {
  const lines = text
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \u00a0]{2,}/g, ' ').trim())
    .filter((line) => line.length >= MIN_LINE_LENGTH && line.length <= MAX_LINE_LENGTH)
    .filter((line, index, arr) => index === 0 || line !== arr[index - 1]);

  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped.length >= MAX_CONTENT_LINES) break;
    deduped.push(line);
  }
  return deduped.join('\n').trim();
}

export type PageReadablePayload = {
  title: string;
  text: string;
};

/**
 * Runs in Playwright page.evaluate — extract main content from any page layout.
 */
export function extractReadableContentInPage(): PageReadablePayload {
  // Literals only — runs inside Playwright page.evaluate (no module scope).
  const maxLines = 120;
  const minLineLen = 2;
  const maxLineLen = 600;

  const pageTitle = (document.title && document.title.trim()) || '';
  const bodyText = () => {
    const body = document.body;
    const doc = document.documentElement;
    if (body && body.innerText) return body.innerText;
    if (doc && doc.innerText) return doc.innerText;
    return '';
  };

  try {
    const scanTarget =
      document.querySelector('main') ||
      document.querySelector('article') ||
      document.querySelector('[role="main"]') ||
      document.body ||
      document.documentElement;

    if (!scanTarget || typeof scanTarget.querySelectorAll !== 'function') {
      return { title: pageTitle, text: bodyText() };
    }

    const lines: string[] = [];
    const seen: Record<string, boolean> = {};

    const addLine = (raw: string, prefix: string) => {
      const line = (prefix + raw).replace(/\s+/g, ' ').trim();
      if (line.length < minLineLen || line.length > maxLineLen) return;
      const key = line.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      lines.push(line);
    };

    const nodes = scanTarget.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td, th, a');
    for (let i = 0; i < nodes.length && lines.length < maxLines; i++) {
      const el = nodes[i] as HTMLElement;
      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      const text = el.innerText ? el.innerText.trim() : '';
      if (!text) continue;
      if (tag.charAt(0) === 'h') {
        const level = parseInt(tag.charAt(1), 10) || 2;
        let hashes = '';
        for (let h = 0; h < Math.min(level, 4); h++) hashes += '#';
        addLine(text, hashes + ' ');
      } else if (tag === 'li') {
        addLine(text, '- ');
      } else if (tag === 'a' && text.length > 8 && text.length < 120) {
        const anchor = el as HTMLAnchorElement;
        if (anchor.href && anchor.href.indexOf('http') === 0) {
          addLine(text + ' (' + anchor.href + ')', '');
        }
      } else if (tag === 'p' || tag === 'td' || tag === 'th') {
        addLine(text, '');
      }
    }

    if (lines.length < 8) {
      const fallback = (scanTarget as HTMLElement).innerText || bodyText();
      return { title: pageTitle, text: fallback };
    }
    return { title: pageTitle, text: lines.join('\n') };
  } catch {
    return { title: pageTitle, text: bodyText() };
  }
}

export function formatWebFetchResult(
  url: string,
  rawText: string,
  offset: number,
  maxChars: number,
  meta?: { title?: string; via?: 'http' | 'browser' },
): string {
  const normalized = normalizePlainText(rawText);
  const totalLength = normalized.length;
  const slice = normalized.substring(offset, offset + maxChars);
  const isTruncated = offset + maxChars < totalLength;

  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep url */
  }

  const header = [
    '# Web page content',
    `URL: ${url}`,
    meta?.title ? `Title: ${meta.title}` : null,
    `Source: ${meta?.via === 'browser' ? 'browser (JavaScript rendered)' : 'HTTP'}`,
    `Host: ${host}`,
    `Range: characters ${offset}–${offset + slice.length} of ${totalLength}`,
  ]
    .filter(Boolean)
    .join('\n');

  let body = `${header}\n\n---\n\n${slice}`;

  if (isTruncated) {
    body += `\n\n---\n\n[More content available. Call web_fetch with offset=${offset + maxChars} to continue.]`;
  }
  return body;
}
