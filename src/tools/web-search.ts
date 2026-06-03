import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { withSharedStealthPage } from '../utils/playwright-pool';
import { cache } from '../utils/cache';
import { requiresLiveLookup } from '../agents/prompt-context';
import { withPlaywrightLock } from '../utils/playwright-lock';
import { getAgentRunContext } from '../agents/agent-run-context';
import { normalizeSearchQueryKey } from './web-url-policy';
import { classifyUrlForFetch } from './web-heuristics';
import { configManager } from '../config/index';
import {
  isSearxngAvailable,
  probeSearxngAvailability,
  searchSearxng,
  type SearxngSearchHit,
} from './searxng-client';

const CACHE_TTL_MS = 15 * 60 * 1000;
const LIVE_CACHE_TTL_MS = 60 * 1000;
const WEB_SEARCH_NAV_TIMEOUT_MS = 20_000;
const WEB_SEARCH_TOOL_TIMEOUT_MS = 45_000;
const WEB_FETCH_HTTP_TIMEOUT_MS = 18_000;
const MAX_FALLBACK_RESULTS = 15;

export type SearchHit = {
  title: string;
  snippet: string;
  url: string;
  source_engine?: string;
  score?: number;
  publishedDate?: string;
};

function isSkillToolCancelled(): boolean {
  return getAgentRunContext()?.skillRunCancelled === true;
}

function formatSearchResults(query: string, results: SearchHit[]): string {
  const blocks: string[] = [];
  const fetchNext: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    let host = '';
    try {
      host = new URL(r.url).hostname;
    } catch {
      host = '';
    }
    const snippet =
      r.snippet.length > 320 ? `${r.snippet.slice(0, 320)}…` : r.snippet;
    const fetchHint = classifyUrlForFetch(r.url);
    if (fetchHint.class === 'recommended') {
      fetchNext.push(`[${i + 1}] ${r.url}`);
    }
    const engineLine = r.source_engine ? `Engine: ${r.source_engine}\n` : '';
    const scoreLine =
      r.score !== undefined && !Number.isNaN(r.score) ? `Score: ${r.score}\n` : '';
    const dateLine = r.publishedDate ? `Published: ${r.publishedDate}\n` : '';
    blocks.push(
      `[${i + 1}] ${r.title}\n` +
        `${host ? `Site: ${host}\n` : ''}` +
        `${engineLine}` +
        `${scoreLine}` +
        `${dateLine}` +
        `URL: ${r.url}\n` +
        `web_fetch: ${fetchHint.class} — ${fetchHint.note}\n` +
        `Snippet: ${snippet}`,
    );
  }
  let out = `Search results for: "${query}"\n\n${blocks.join('\n\n')}`;
  if (fetchNext.length > 0) {
    out +=
      '\n\nNext step: call web_fetch on these HTML URLs (part=0; use part=1+ or focus for more):\n' +
      fetchNext.join('\n');
  } else if (results.length > 0) {
    out +=
      '\n\nNext step: call web_fetch on the best HTML result URL above (skip PDF/binary).';
  }
  return out;
}

function normalizeSearchResultUrl(raw: string): string {
  let url = raw.replace(/&amp;/g, '&').trim();
  if (!url) return url;
  if (url.startsWith('//')) url = `https:${url}`;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('duckduckgo.com') && parsed.searchParams.has('uddg')) {
      const dest = parsed.searchParams.get('uddg');
      if (dest) return decodeURIComponent(dest);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

function simplifySearchQuery(query: string): string | null {
  const simplified = query
    .replace(/\b(under\s+\d+|20\d{2})\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (simplified.length >= 8 && simplified.toLowerCase() !== query.toLowerCase()) {
    return simplified;
  }
  return null;
}

async function plainFetchRaw(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEB_FETCH_HTTP_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    return html.length > 0 ? html : null;
  } catch {
    return null;
  }
}

async function fetchDuckDuckGoResults(query: string): Promise<SearchHit[] | null> {
  const html = await plainFetchRaw(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  );
  if (!html || html.length < 200) return null;

  const results: SearchHit[] = [];
  const blockRe =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="result__a"|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null && results.length < MAX_FALLBACK_RESULTS) {
    const url = normalizeSearchResultUrl(match[1]);
    const title = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const tail = match[3] ?? '';
    const snippetMatch =
      tail.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i) ??
      tail.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = (snippetMatch?.[1] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (title && url) {
      results.push({ title, url, snippet });
    }
  }
  return results.length > 0 ? results : null;
}

async function searchViaYahooPlaywright(query: string): Promise<SearchHit[] | null> {
  return withPlaywrightLock(async () => {
    try {
      console.log(`[Tool: Web Search] Yahoo browser search for: "${query}"`);
      return await withSharedStealthPage(async (page) => {
        page.setDefaultTimeout(WEB_SEARCH_NAV_TIMEOUT_MS);
        await page.goto(`https://search.yahoo.com/search?p=${encodeURIComponent(query)}`, {
          waitUntil: 'domcontentloaded',
          timeout: WEB_SEARCH_NAV_TIMEOUT_MS,
        });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const results: SearchHit[] = await page.$$eval('.algo', (elements) =>
          elements
            .slice(0, MAX_FALLBACK_RESULTS)
            .map((el) => {
              const titleEl = el.querySelector('a, h3');
              const snippetEl = el.querySelector('.compTitle + div, .compText, p');
              const urlEl = el.querySelector('a');
              return {
                title: titleEl?.textContent?.trim() ?? '',
                snippet: snippetEl?.textContent?.trim() ?? '',
                url: urlEl?.getAttribute('href')?.trim() ?? '',
              };
            })
            .filter((r) => r.title && r.url),
        );
        return results.length > 0 ? results : null;
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Tool: Web Search] Yahoo browser search failed: ${msg}`);
      return null;
    }
  });
}

function mapSearxHits(hits: SearxngSearchHit[]): SearchHit[] {
  return hits.map((h) => ({
    title: h.title,
    url: h.url,
    snippet: h.snippet,
    source_engine: h.source_engine,
    score: h.score,
    publishedDate: h.publishedDate,
  }));
}

async function searchViaSearxng(
  query: string,
  timeRange?: string,
): Promise<SearchHit[] | null> {
  console.log(`[Tool: Web Search] SearXNG search for: "${query}"`);
  const hits = await searchSearxng(query, { timeRange });
  if (!hits?.length) return null;
  return mapSearxHits(hits);
}

async function searchFallbackProviders(query: string): Promise<SearchHit[] | null> {
  const ws = configManager.getConfig().webSearch;
  if (!ws.httpFallbackEnabled && !ws.browserFallbackEnabled) {
    return null;
  }

  if (ws.httpFallbackEnabled) {
    const ddg = await fetchDuckDuckGoResults(query);
    if (ddg && ddg.length > 0) return ddg;
  }

  if (ws.browserFallbackEnabled) {
    const yahoo = await searchViaYahooPlaywright(query);
    if (yahoo && yahoo.length > 0) return yahoo;
  }

  const simplified = simplifySearchQuery(query);
  if (!simplified) return null;

  console.log(`[Tool: Web Search] Retrying simplified query: "${simplified}"`);
  if (ws.httpFallbackEnabled) {
    const ddgRetry = await fetchDuckDuckGoResults(simplified);
    if (ddgRetry && ddgRetry.length > 0) return ddgRetry;
  }
  if (ws.browserFallbackEnabled) {
    return searchViaYahooPlaywright(simplified);
  }
  return null;
}

async function searchAllProviders(
  query: string,
  timeRange?: string,
): Promise<{ hits: SearchHit[]; provider: 'searxng' | 'fallback' } | null> {
  await probeSearxngAvailability();

  if (isSearxngAvailable()) {
    const searx = await searchViaSearxng(query, timeRange);
    if (searx && searx.length > 0) return { hits: searx, provider: 'searxng' };
    console.log('[Tool: Web Search] SearXNG returned no hits — trying fallbacks');
  }

  const fallback = await searchFallbackProviders(query);
  if (fallback && fallback.length > 0) return { hits: fallback, provider: 'fallback' };
  return null;
}

async function runWebSearch(query: string, timeRange?: string): Promise<string> {
  const runCtx = getAgentRunContext();
  if (runCtx) {
    runCtx.lastWebSearchQuery = query.trim();
  }

  const outcome = await searchAllProviders(query, timeRange);
  if (outcome) {
    const via = outcome.provider === 'searxng' ? 'SearXNG' : 'DuckDuckGo/Yahoo';
    console.log(`[Tool: Web Search] Search succeeded via ${via} (${outcome.hits.length} hits)`);
    return formatSearchResults(query, outcome.hits);
  }
  if (isSearxngAvailable()) {
    return (
      `No search results for: "${query}". ` +
      'SearXNG is up but returned no hits — try simpler keywords or web_fetch on a known URL.'
    );
  }
  const ws = configManager.getConfig().webSearch;
  if (!ws.httpFallbackEnabled && !ws.browserFallbackEnabled) {
    return (
      `No search results for: "${query}". ` +
      'SearXNG unavailable and search fallbacks are disabled in settings.'
    );
  }
  return (
    `No search results for: "${query}". ` +
    'Try simpler keywords or use web_fetch on a known URL directly.'
  );
}

function registerSearchDedupe(query: string): string | null {
  const runCtx = getAgentRunContext();
  if (!runCtx?.orgTaskId) return null;
  const key = normalizeSearchQueryKey(query);
  if (!runCtx.webSearchKeys) runCtx.webSearchKeys = new Set();
  if (runCtx.webSearchKeys.has(key)) {
    return (
      `Duplicate search skipped for this task (already ran): "${query}". ` +
      'Use prior results or web_fetch on a URL from those results.'
    );
  }
  runCtx.webSearchKeys.add(key);
  return null;
}

const timeRangeSchema = z.enum(['day', 'week', 'month', 'year']).optional();

export const webSearchTool = tool(
  async ({ query, timeRange }) => {
    if (isSkillToolCancelled()) {
      return 'Search skipped — skill run already ended (tool limit or timeout).';
    }

    const duplicate = registerSearchDedupe(query);
    if (duplicate) {
      console.log(`[Tool: Web Search] Deduped: "${query}"`);
      return duplicate;
    }

    const isLive = requiresLiveLookup(query);
    const cacheKey = isLive
      ? `search:live:${query.toLowerCase().trim()}:${timeRange ?? ''}`
      : `search:${query.toLowerCase().trim()}:${timeRange ?? ''}`;
    const ttlMs = isLive ? LIVE_CACHE_TTL_MS : CACHE_TTL_MS;
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[Tool: Web Search] Cache hit (${isLive ? 'live 60s' : '15m'}) for: "${query}"`);
      const runCtx = getAgentRunContext();
      if (runCtx) runCtx.lastWebSearchQuery = query.trim();
      return cached;
    }

    console.log(`[Tool: Web Search] Searching for: "${query}"`);

    try {
      const result = await Promise.race([
        runWebSearch(query, timeRange),
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Search timed out after ${WEB_SEARCH_TOOL_TIMEOUT_MS}ms`)),
            WEB_SEARCH_TOOL_TIMEOUT_MS,
          ),
        ),
      ]);
      await cache.set(cacheKey, result, ttlMs);
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Tool: Web Search] Search failed:', e);
      return `Failed to search the internet: ${msg}`;
    }
  },
  {
    name: 'web_search',
    description:
      'Search the internet (local SearXNG when available, else configured fallbacks). ' +
      'Returns titles, scores, dates, snippets, and URLs. Follow with web_fetch (part/focus for long pages).',
    schema: z.object({
      query: z.string().describe('The search query to look up on the internet.'),
      timeRange: timeRangeSchema.describe('Optional recency filter: day, week, month, or year.'),
    }),
  },
);
