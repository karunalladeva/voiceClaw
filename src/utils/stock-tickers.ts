/** Extract US-style tickers from natural language (pipeline + live-data guards). */

const TICKER_BLOCKLIST = new Set([
  'TOP',
  'THE',
  'FOR',
  'AND',
  'OR',
  'NOT',
  'ALL',
  'ANY',
  'ETF',
  'IPO',
  'CEO',
  'CFO',
  'GDP',
  'FED',
  'SEC',
  'USD',
  'EUR',
  'API',
  'AI',
  'US',
  'UK',
  'EU',
  'VS',
  'VIA',
  'WITH',
  'FROM',
  'INTO',
  'OVER',
  'UNDER',
  'BEST',
  'LIVE',
  'NEWS',
  'DATA',
  'STOCK',
  'STOCKS',
  'MARKET',
  'MARKETS',
  'ANALYZE',
  'SUMMARY',
  'EACH',
]);

const TICKER_RE = /\b[A-Z]{1,5}\b/g;

function isLikelyTicker(symbol: string): boolean {
  const s = symbol.toUpperCase();
  if (s.length < 1 || s.length > 5) return false;
  if (TICKER_BLOCKLIST.has(s)) return false;
  if (!/^[A-Z]+$/.test(s)) return false;
  return true;
}

function parseTickerList(fragment: string): string[] {
  const found: string[] = [];
  for (const m of fragment.matchAll(TICKER_RE)) {
    const sym = m[0].toUpperCase();
    if (isLikelyTicker(sym)) found.push(sym);
  }
  return [...new Set(found)];
}

/**
 * All tickers mentioned explicitly (colon/comma lists) or as known symbols in text.
 */
export function extractStockSymbols(query: string, explicitSymbol?: string): string[] {
  if (explicitSymbol?.trim()) {
    if (explicitSymbol.toUpperCase() === 'MULTI') {
      return parseTickerList(query);
    }
    return parseTickerList(
      explicitSymbol.includes(',') ? explicitSymbol : `${explicitSymbol} ${query}`,
    );
  }

  const text = query.trim();
  if (!text) return [];

  const colonList = text.match(/:\s*([A-Z][A-Za-z0-9.\-]*(?:\s*,\s*[A-Z][A-Za-z0-9.\-]*)+)/);
  if (colonList) {
    const fromColon = parseTickerList(colonList[1]);
    if (fromColon.length > 0) return fromColon;
  }

  const commaRun = text.match(
    /\b([A-Z]{1,5}(?:\s*,\s*[A-Z]{1,5}){2,})\b/i,
  );
  if (commaRun) {
    const fromComma = parseTickerList(commaRun[1]);
    if (fromComma.length >= 2) return fromComma;
  }

  const parenMatch = text.match(/\(([A-Z]{1,5}(?:\s*,\s*[A-Z]{1,5})*)\)/);
  if (parenMatch) {
    const fromParen = parseTickerList(parenMatch[1]);
    if (fromParen.length > 0) return fromParen;
  }

  const suffixMatch = text.match(
    /\b([A-Z]{1,5})\b(?:\s+stock|\s+stocks|\s+ticker|\s+shares)\b/i,
  );
  if (suffixMatch && isLikelyTicker(suffixMatch[1])) {
    return [suffixMatch[1].toUpperCase()];
  }

  return [];
}

/** First ticker when a single-symbol fallback is required. */
export function extractStockSymbol(query: string, explicitSymbol?: string): string | null {
  const symbols = extractStockSymbols(query, explicitSymbol);
  return symbols[0] ?? null;
}
