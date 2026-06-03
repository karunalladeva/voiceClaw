/**
 * Generic HTML enrichment for ranked listing / catalog pages.
 */

import { isLikelyDetailPageUrl } from './web-heuristics';

const MAX_LISTING_ROWS = 25;
const MAX_DETAIL_LINKS = 15;

export type ListingRow = { rank: number; title: string; detail?: string };

/** Extract ranked rows and same-site detail links from HTML. */
export function enrichCatalogHtml(html: string, pageUrl: string): string | null {
  const rows = extractRankedListings(html);
  const links = extractDetailPageLinks(html, pageUrl);
  if (rows.length === 0 && links.length === 0) return null;

  const lines: string[] = ['## Parsed catalog signals', `Source: ${pageUrl}`];
  if (rows.length > 0) {
    lines.push('', '### Ranked items');
    for (const row of rows.slice(0, MAX_LISTING_ROWS)) {
      const extra = row.detail ? ` — ${row.detail}` : '';
      lines.push(`${row.rank}. ${row.title}${extra}`);
    }
  }
  if (links.length > 0) {
    lines.push('', '### Detail page URLs (from page links)');
    for (const link of links.slice(0, MAX_DETAIL_LINKS)) {
      lines.push(`- ${link}`);
    }
  }
  return lines.join('\n');
}

export function extractRankedListings(html: string): ListingRow[] {
  const rows: ListingRow[] = [];
  const seen = new Set<string>();

  const push = (rank: number, title: string, detail?: string) => {
    const t = decodeEntities(title).replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 200) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ rank, title: t, detail: detail?.trim() });
  };

  const truncateTitleRe =
    /<(?:span|a|div)[^>]*class="[^"]*truncate[^"]*"[^>]*>([\s\S]*?)<\/(?:span|a|div)>/gi;
  let tMatch: RegExpExecArray | null;
  let tRank = 0;
  while ((tMatch = truncateTitleRe.exec(html)) !== null && rows.length < MAX_LISTING_ROWS) {
    tRank += 1;
    const title = tMatch[1].replace(/<[^>]+>/g, ' ').trim();
    if (title.length >= 3) push(tRank, title);
  }

  const rankTitleRe = /#\s*(\d{1,3})\s+([\s\S]{3,180}?)(?=\s+#\s*\d|\s*<|$)/gi;
  let rMatch: RegExpExecArray | null;
  while ((rMatch = rankTitleRe.exec(stripTags(html))) !== null && rows.length < MAX_LISTING_ROWS) {
    push(Number(rMatch[1]), rMatch[2]);
  }

  const olRe = /<ol[^>]*>([\s\S]*?)<\/ol>/gi;
  let olMatch: RegExpExecArray | null;
  while ((olMatch = olRe.exec(html)) !== null && rows.length < MAX_LISTING_ROWS) {
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch: RegExpExecArray | null;
    let i = 0;
    while ((liMatch = liRe.exec(olMatch[1])) !== null && rows.length < MAX_LISTING_ROWS) {
      i += 1;
      const text = liMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text.length >= 5) push(i, text);
    }
  }

  return rows.sort((a, b) => a.rank - b.rank);
}

export function extractDetailPageLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  const hrefRe = /href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && links.length < MAX_DETAIL_LINKS) {
    const raw = m[1].replace(/&amp;/g, '&').trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) continue;
    let absolute: string;
    try {
      absolute = new URL(raw, baseUrl).href;
    } catch {
      continue;
    }
    if (!isLikelyDetailPageUrl(absolute, baseUrl)) continue;
    const key = absolute.split('?')[0]!.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(absolute);
  }
  return links;
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
