import { tokenize } from './bm25';

const MARKETPLACE_HINTS = ['price', 'reviews', 'rating', 'bestseller', 'bsr', 'competitor', 'etsy', 'gumroad'];

export function expandRankingQuery(parts: Array<string | undefined | null>, maxTerms = 24): string {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of parts) {
    const p = part?.trim();
    if (!p) continue;
    for (const t of tokenize(p)) {
      if (seen.has(t)) continue;
      seen.add(t);
      tokens.push(t);
      if (tokens.length >= maxTerms) break;
    }
    if (tokens.length >= maxTerms) break;
  }
  return tokens.join(' ');
}

export function extractQueryVariants(primary: string): string[] {
  const trimmed = primary.trim();
  if (!trimmed) return [];
  const variants: string[] = [trimmed];

  const quoted = trimmed.match(/"([^"]{3,120})"/g);
  if (quoted?.[0]) {
    const inner = quoted[0].replace(/"/g, '').trim();
    if (inner && inner !== trimmed) variants.push(inner);
  }

  const words = tokenize(trimmed);
  if (words.length > 4) {
    variants.push(words.slice(0, 6).join(' '));
  }

  return [...new Set(variants)].slice(0, 3);
}

export function marketplaceHintTokens(contextText: string | undefined): string {
  if (!contextText) return '';
  const lower = contextText.toLowerCase();
  const hits = MARKETPLACE_HINTS.filter((h) => lower.includes(h));
  return hits.slice(0, 6).join(' ');
}
