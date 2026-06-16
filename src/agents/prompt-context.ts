import type { Message } from '../runtime/messages';
import { messageContentToString } from '../runtime/messages';
import { extractStockSymbols } from '../utils/stock-tickers';

/** Extract plain text from string or multimodal user input. */
export function extractUserQueryText(input: string | unknown): string {
  if (typeof input === 'string') return input.trim();
  if (Array.isArray(input)) {
    const textPart = input.find(
      (part: { type?: string; text?: string }) => part?.type === 'text' && part.text,
    ) as { text?: string } | undefined;
    return textPart?.text?.trim() || '';
  }
  return '';
}

const TIME_WORDS =
  /\b(today|current|currently|now|latest|live|right now|at the moment|updated|newest|recent)\b/i;
const VOLATILE_TOPICS =
  /\b(price|rate|gold|silver|stock|crypto|weather|temperature|news|score|traffic|exchange|market|match|ipl|cricket|football|soccer|game|overs|inning|qualifier|final|forecast|headline)\b/i;
const LIVE_SHORT_PHRASES =
  /\b(current score|live score|score now|price now|latest news|breaking news|match status|who wins|who won)\b/i;
const VERIFY_FOLLOW_UP =
  /\b(is (that|this|it) right|correct score|right score|actually right|verify|double check|confirm that|that correct)\b/i;

export type LiveLookupDomain = 'sports' | 'markets' | 'weather' | 'news' | 'general';

/** Time-sensitive query that must use live tools — not memory or prior replies alone. */
export function requiresLiveLookup(query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return false;
  if (LIVE_SHORT_PHRASES.test(text)) return true;
  if (VERIFY_FOLLOW_UP.test(text)) return true;
  if (TIME_WORDS.test(text) && VOLATILE_TOPICS.test(text)) return true;
  if (/\b(live|score|match)\b/i.test(text) && VOLATILE_TOPICS.test(text)) return true;
  return false;
}

export function getLiveLookupDomain(query: string): LiveLookupDomain {
  const text = query.trim().toLowerCase();
  if (/\b(ipl|cricket|match|score|overs|inning|qualifier|t20|test match|football|soccer|nba|nfl)\b/i.test(text)) {
    return 'sports';
  }
  if (isTradingRelatedQuery(query)) return 'markets';
  if (/\b(weather|temperature|forecast|rain|humidity)\b/i.test(text)) return 'weather';
  if (/\b(news|headline|breaking|election|event)\b/i.test(text)) return 'news';
  return 'general';
}

/** Greetings and small talk — skip memory fetch and use compact skill routing. */
export function isCasualMessage(query: string): boolean {
  if (requiresLiveLookup(query)) return false;
  const text = query.trim().toLowerCase();
  if (!text) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 4) return false;
  if (text.includes('?')) return false;
  const casualPattern =
    /^(hi|hello|hey|yo|sup|thanks|thank you|thx|ok|okay|bye|goodbye|good morning|good night|good afternoon|howdy|what's up|whats up)\b/;
  if (casualPattern.test(text)) return true;
  return words.length <= 2 && text.length < 24;
}

/** User message likely needs trading-skill detail in the system prompt. */
export function isTradingRelatedQuery(query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return false;
  const tradingPattern =
    /\b(stock|stocks|etf|crypto|bitcoin|btc|eth|forex|fx|option|options|trade|trading|market|ticker|symbol|portfolio|dividend|earnings|rsi|macd|ema|sma|ohlcv|chart|nasdaq|nyse|nflx|aapl|tsla|nvda|buy|sell|hold|short|long|funding|perp|defi|yield|valuation|macro|sec|edgar|ccxt|yahoo finance)\b/i;
  return tradingPattern.test(text);
}

/** Tool output contains scores, prices, or other volatile numbers — do not LLM-summarize away. */
export function hasVolatileNumericToolOutput(content: string): boolean {
  if (!content || content.length < 20) return false;
  if (/\d+\s*\/\s*\d+/.test(content)) return true;
  if (/\b(overs?|wickets?|runs? needed|target|chase)\b/i.test(content) && /\d+/.test(content)) return true;
  if (/\$[\d,]+|\b\d+(\.\d+)?%\b|\b(price|temp|temperature|high|low):\s*\d/i.test(content)) return true;
  return false;
}

const MARKET_TOOLS =
  /\b(yahoo_ohlcv|yahoo_news|yfinance|market_snapshot|get_quote|stock_price|ccxt_|trading-)\b/i;
const MEMORY_ONLY_TOOLS = /\b(list_memories|search_memory|store_memory)\b/i;

export function isMemoryOnlyToolName(toolName: string): boolean {
  return MEMORY_ONLY_TOOLS.test(toolName);
}

export function toolTraceHasAdequateLiveData(
  toolTrace: Array<{ tool: string; args?: Record<string, unknown> }>,
  domain: LiveLookupDomain,
  userQuery?: string,
): boolean {
  if (toolTrace.length === 0) return false;
  const names = toolTrace.map((t) => t.tool);
  const usedWebFetch = names.some((n) => /web_fetch/i.test(n));
  const usedWebSearch = names.some((n) => /web_search/i.test(n));
  const usedWebResearcher = toolTrace.some(
    (t) => t.tool === 'route_to_skill' && String(t.args?.skillId ?? '') === 'web-researcher',
  );
  if (domain === 'markets') {
    const usedMarket = names.some((n) => MARKET_TOOLS.test(n));
    if (!usedMarket) return usedWebSearch && usedWebFetch;

    const requested = extractStockSymbols(userQuery?.trim() || '');
    if (requested.length <= 1) return true;

    const fetched = new Set<string>();
    for (const t of toolTrace) {
      if (!/^yahoo_/i.test(t.tool)) continue;
      const sym = t.args?.symbol;
      if (typeof sym === 'string' && sym.trim()) {
        fetched.add(sym.trim().toUpperCase());
      }
    }
    const minRequired = Math.min(requested.length, 3);
    const covered = requested.filter((s) => fetched.has(s)).length;
    return covered >= minRequired || fetched.size >= minRequired;
  }
  if (domain === 'sports' || domain === 'weather' || domain === 'news' || domain === 'general') {
    return (usedWebSearch && usedWebFetch) || usedWebResearcher;
  }
  return usedWebSearch || usedWebFetch || usedWebResearcher;
}

const EMBEDDED_MARKET_MARKER = '## Market data for ';

export function inputHasEmbeddedMarketData(text: string): boolean {
  return text.includes(EMBEDDED_MARKET_MARKER);
}

/** User message is synthesizing over pipeline/Yahoo blocks already in context. */
export function isSynthesisOverProvidedData(text: string): boolean {
  const t = text.trim();
  if (!inputHasEmbeddedMarketData(t)) return false;
  return /\b(summarize|summary|synthesis|analyze each|recommendations?|key metrics|per symbol|each of the|for each)\b/i.test(
    t,
  );
}

const PIPELINE_HISTORY_MARKERS =
  /\[Pipeline Output\]|\[pipeline\]|Recommendation:|Current Price|TECH SECTOR|## Market data for /i;

const PRESENTATION_INTENT =
  /\b(table view|format as|in a table|as columns|list each|reformat|show as)\b|\btable\b/i;

const EXPLICIT_LIVE_REFRESH = /\b(latest|live|fetch|update|right now)\b/i;

/** Standalone buy/sell language — live trading, not history reformat. */
export function isStandaloneLiveTradingQuery(query: string): boolean {
  const t = query.trim();
  if (!t) return false;
  if (PRESENTATION_INTENT.test(t)) return false;
  if (/\bbuy\s*[|/]\s*sell\b/i.test(t)) return true;
  if (/\bbuy\/sell\b/i.test(t)) return true;
  if (/\b(should I buy|hold or sell|buy or sell)\b/i.test(t)) return true;
  if (/\b(entry|exit)\b/i.test(t) && /\b(trade|trading|stock|position)\b/i.test(t)) return true;
  if (/\bsignal(s)?\b/i.test(t) && /\b(buy|sell|trade|trading)\b/i.test(t)) return true;
  return false;
}

export function hasPipelineHistorySignal(historyText: string): boolean {
  return PIPELINE_HISTORY_MARKERS.test(historyText);
}

export function hasPresentationIntent(query: string): boolean {
  return PRESENTATION_INTENT.test(query.trim());
}

export function extractHistoryText(messages: Message[]): string {
  return messages
    .map((m) => messageContentToString(m.content))
    .filter(Boolean)
    .join('\n');
}

/** Reformat/summarize prior pipeline or report content already in chat history. */
export function isFollowUpOverProvidedHistory(query: string, historyText: string): boolean {
  if (!historyText.trim()) return false;
  if (!hasPipelineHistorySignal(historyText)) return false;
  if (!hasPresentationIntent(query)) return false;
  if (EXPLICIT_LIVE_REFRESH.test(query.trim())) return false;
  if (isStandaloneLiveTradingQuery(query)) return false;
  return true;
}

export function shouldUseSynthesisMode(query: string, historyText?: string, sessionRagHint?: boolean): boolean {
  if (isSynthesisOverProvidedData(query)) return true;
  if (historyText && isFollowUpOverProvidedHistory(query, historyText)) return true;
  if (sessionRagHint && hasPresentationIntent(query)) return true;
  return false;
}

/** T20 cricket reply with impossible overs remaining. */
export function failsCricketSanityCheck(response: string): boolean {
  const oversLeft = response.match(/(\d+(?:\.\d+)?)\s*overs?\s*(left|remaining|to go|to bat)/i);
  if (oversLeft && parseFloat(oversLeft[1]) > 20) return true;
  return false;
}

const MEMORY_RECALL_SIGNAL =
  /\b(remember|recall|what did i tell you|my preference|my timezone|my location|you know my|stored memory|save this|list memories|search memory)\b/i;

/** Skip vector memory injection for specialist non-trading lanes (KDP, ComfyUI, etc.). */
export function shouldInjectMemoryForQuery(query: string, microRouteLane?: string): boolean {
  if (isCasualMessage(query)) return false;
  if (MEMORY_RECALL_SIGNAL.test(query)) return true;
  if (!microRouteLane || microRouteLane === 'general') return true;
  if (microRouteLane === 'markets' || microRouteLane === 'trading') return true;
  if (isTradingRelatedQuery(query)) return true;
  return false;
}
