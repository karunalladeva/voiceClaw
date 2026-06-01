import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { chromium } from 'playwright';
import { withStealthBrowser } from '../utils/stealth-playwright';
import * as https from 'https';
import * as http from 'http';
import { cache } from '../utils/cache';
import { requiresLiveLookup } from '../agents/prompt-context';
import { withPlaywrightLock } from '../utils/playwright-lock';
import {
  extractReadableContentInPage,
  formatWebFetchResult,
  htmlToReadableText,
} from './web-fetch-format';


/** Max characters for generic (non-marketplace) text slices. */
const MAX_PAGE_CHARS = 8000;

const CACHE_TTL_MS = 15 * 60 * 1000;
const LIVE_CACHE_TTL_MS = 60 * 1000;
const WEB_SEARCH_NAV_TIMEOUT_MS = 20_000;
const WEB_SEARCH_TOOL_TIMEOUT_MS = 45_000;
const YAHOO_SEARCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** Total budget per web_fetch call (includes waiting on Playwright lock after web_search). */
const WEB_FETCH_TOOL_TIMEOUT_MS = 120_000;
/** Browser work only — starts after lock acquired (not while queued). */
const WEB_FETCH_BROWSER_TIMEOUT_MS = 75_000;
const WEB_FETCH_NAV_TIMEOUT_MS = 45_000;
const WEB_FETCH_HTTP_TIMEOUT_MS = 18_000;
const WEB_FETCH_CACHE_TTL_MS = 15 * 60 * 1000;

type SearchHit = { title: string; snippet: string; url: string };

function formatSearchResults(query: string, results: SearchHit[]): string {
  const formatted = results
    .map((r, i) => {
      let host = '';
      try {
        host = new URL(r.url).hostname;
      } catch {
        host = '';
      }
      const snippet =
        r.snippet.length > 320 ? `${r.snippet.slice(0, 320)}…` : r.snippet;
      return `[${i + 1}] ${r.title}\n${host ? `Site: ${host}\n` : ''}URL: ${r.url}\nSnippet: ${snippet}`;
    })
    .join('\n\n');
  return (
    `Search results for: "${query}"\n\n` +
    formatted +
    '\n\nTip: Use web_fetch on HTML listing pages (not .pdf). Prefer direct marketplace URLs from results above.'
  );
}

function isUnfetchableUrl(url: string): string | null {
  const lower = url.toLowerCase();
  if (/\.pdf(\?|$)/i.test(lower)) {
    return 'PDF URLs cannot be read as text — pick the HTML Top Ads or Discover page from web_search instead.';
  }
  if (lower.includes('creative_center_top_ads_one_pager')) {
    return 'This TikTok link is a PDF brochure, not the live Top Ads dashboard. Use the topads HTML URL from search.';
  }
  return null;
}

/** Amazon often returns nav/sign-in HTML over HTTP with no bestseller titles. */
function isAmazonShellPage(text: string, url: string): boolean {
  if (!/amazon\./i.test(url)) return false;
  const lower = text.toLowerCase();
  const hasShell =
    lower.includes('keyboard shortcuts') ||
    lower.includes('deliver to') ||
    lower.includes('hello, sign in') ||
    lower.includes('skip to main content');
  const hasTitles =
    /#\d|best sellers|kindle|p13n-sc-truncate|out of 5 stars|\$\d/.test(text);
  return hasShell && !hasTitles;
}

function isBinaryGarbage(text: string): boolean {
  const sample = text.slice(0, 200);
  return sample.startsWith('%PDF') || (sample.includes('JFIF') && sample.includes('endobj'));
}

function simplifySearchQuery(query: string): string | null {
  const simplified = query
    .replace(/\b(BSR|under\s+\d+|2024|2025|2026|high|low)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (simplified.length >= 8 && simplified.toLowerCase() !== query.toLowerCase()) {
    return simplified;
  }
  return null;
}

async function searchViaDuckDuckGoHttp(query: string): Promise<SearchHit[] | null> {
  return fetchDuckDuckGoResults(query);
}

/** Yahoo HTML scrape via headless browser — reliable when DDG HTTP is blocked or empty. */
async function searchViaYahooPlaywright(query: string): Promise<SearchHit[] | null> {
  return withPlaywrightLock(async () => {
    let browser;
    try {
      console.log(`[Tool: Web Search] Yahoo browser search for: "${query}"`);
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ userAgent: YAHOO_SEARCH_USER_AGENT });
      const page = await context.newPage();
      page.setDefaultTimeout(WEB_SEARCH_NAV_TIMEOUT_MS);
      await page.goto(`https://search.yahoo.com/search?p=${encodeURIComponent(query)}`, {
        waitUntil: 'domcontentloaded',
        timeout: WEB_SEARCH_NAV_TIMEOUT_MS,
      });
      await page.waitForTimeout(2000);
      const results: SearchHit[] = await page.$$eval('.algo', (elements) =>
        elements
          .slice(0, 5)
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Tool: Web Search] Yahoo browser search failed: ${msg}`);
      return null;
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  });
}

async function searchAllProviders(query: string): Promise<SearchHit[] | null> {
  const ddg = await searchViaDuckDuckGoHttp(query);
  if (ddg && ddg.length > 0) return ddg;

  const yahoo = await searchViaYahooPlaywright(query);
  if (yahoo && yahoo.length > 0) return yahoo;

  const simplified = simplifySearchQuery(query);
  if (!simplified) return null;

  console.log(`[Tool: Web Search] Retrying simplified query: "${simplified}"`);
  const ddgRetry = await searchViaDuckDuckGoHttp(simplified);
  if (ddgRetry && ddgRetry.length > 0) return ddgRetry;

  return searchViaYahooPlaywright(simplified);
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
  while ((match = blockRe.exec(html)) !== null && results.length < 5) {
    const url = match[1].replace(/&amp;/g, '&').trim();
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

async function runWebSearch(query: string): Promise<string> {
  const results = await searchAllProviders(query);
  if (results && results.length > 0) {
    console.log(`[Tool: Web Search] Search succeeded (${results.length} hits)`);
    return formatSearchResults(query, results);
  }

  return (
    `No search results for: "${query}". ` +
    'Try simpler keywords or use web_fetch on a known URL directly.'
  );
}


// ── web_search ────────────────────────────────────────────────────────────────

/**
 * Search the web: DuckDuckGo HTTP first (fast), then Yahoo via headless browser (fallback).
 * Results are cached per-query for 15 minutes (60s for live/time-sensitive queries).
 * Pair with web_fetch to read the content of any result URL.
 */
export const webSearchTool = tool(
  async ({ query }) => {
    const isLive = requiresLiveLookup(query);
    const cacheKey = isLive ? `search:live:${query.toLowerCase().trim()}` : `search:${query.toLowerCase().trim()}`;
    const ttlMs = isLive ? LIVE_CACHE_TTL_MS : CACHE_TTL_MS;
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[Tool: Web Search] Cache hit (${isLive ? 'live 60s' : '15m'}) for: "${query}"`);
      return cached;
    }

    console.log(`[Tool: Web Search] Searching for: "${query}"`);

    try {
      const result = await Promise.race([
        runWebSearch(query),
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Search timed out after ${WEB_SEARCH_TOOL_TIMEOUT_MS}ms`)),
            WEB_SEARCH_TOOL_TIMEOUT_MS,
          ),
        ),
      ]);

      await cache.set(cacheKey, result, ttlMs);
      return result;
    } catch (e: any) {
      console.error('[Tool: Web Search] Search failed:', e);
      return `Failed to search the internet: ${e.message}`;
    }
  },
  {
    name: 'web_search',
    description:
      'Search the internet for up-to-date information, news, or facts. Returns a list of results with titles, short snippets, and URLs. ' +
      'To read the actual content of a result page, use the web_fetch tool with the URL.',
    schema: z.object({
      query: z.string().describe('The search query to look up on the internet.'),
    }),
  },
);

// ── web_fetch ─────────────────────────────────────────────────────────────────

/**
 * Fetch readable text content from a URL via a plain HTTP GET request.
 * Does not execute JavaScript — uses Node's built-in http/https.
 * Falls back to a headless browser only when the plain fetch returns
 * too little content (e.g. JS-rendered sites).
 */
function fetchCacheKey(url: string, offset: number): string {
  return `fetch:${url.trim().toLowerCase()}:o${offset}`;
}

export const webFetchTool = tool(
  async ({ url, offset = 0 }) => {
    console.log(`[Tool: Web Fetch] Fetching (offset: ${offset}): ${url}`);

    const cacheKey = fetchCacheKey(url, offset);
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[Tool: Web Fetch] Cache hit (15m) for: ${url}`);
      return cached;
    }

    try {
      const result = await Promise.race([
        runWebFetch(url, offset),
        new Promise<string>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Fetch timed out after ${WEB_FETCH_TOOL_TIMEOUT_MS}ms (page slow or Playwright queue busy after web_search — retry or use web_search snippets)`,
                ),
              ),
            WEB_FETCH_TOOL_TIMEOUT_MS,
          ),
        ),
      ]);
      if (!result.startsWith('Failed to fetch')) {
        await cache.set(cacheKey, result, WEB_FETCH_CACHE_TTL_MS);
      }
      return result;
    } catch (e: any) {
      console.error('[Tool: Web Fetch] Failed:', e);
      return (
        `Failed to fetch page content: ${e.message}\n\n` +
        'Tip: Prefer web_search snippets, try a simpler URL, or retry once the prior browser tool finishes.'
      );
    }
  },
  {
    name: 'web_fetch',
    description:
      'Fetch and read the text content of any web page URL. Returns a consistent formatted block ' +
      '(URL, title, host, readable body with headings and lists). Use after web_search or for any direct link. ' +
      'Supports offset for pagination on long pages.',
    schema: z.object({
      url: z.string().describe('The full URL of the web page to read.'),
      offset: z.number().optional().default(0).describe('The character offset to start reading from (use for pagination).'),
    }),

  },
);

async function runWebFetch(url: string, offset: number): Promise<string> {
  if (offset > MAX_PAGE_CHARS * 3) {
    return (
      `[FETCH LIMIT] Offset ${offset} is too large. ` +
      `Call web_fetch with a smaller offset or use web_search for another URL.`
    );
  }

  const unfetchable = isUnfetchableUrl(url);
  if (unfetchable) {
    return formatWebFetchResult(url, unfetchable, 0, MAX_PAGE_CHARS, { via: 'http' });
  }

  const rawHtml = await plainFetchRaw(url);
  if (rawHtml && rawHtml.length > 200) {
    const readable = htmlToReadableText(rawHtml);
    if (readable.length > 200 && !isBinaryGarbage(readable) && !isAmazonShellPage(readable, url)) {
      console.log(`[Tool: Web Fetch] HTTP readable extract (${readable.length} chars)`);
      return formatWebFetchResult(url, readable, offset, MAX_PAGE_CHARS, { via: 'http' });
    }
    if (isAmazonShellPage(readable, url)) {
      console.log('[Tool: Web Fetch] Amazon HTTP returned shell only — trying browser');
    }
  }

  console.log(`[Tool: Web Fetch] Plain fetch insufficient — launching headless browser`);
  const lockWaitStart = Date.now();
  return withPlaywrightLock(async () => {
    const lockWaitMs = Date.now() - lockWaitStart;
    if (lockWaitMs > 3000) {
      console.log(`[Tool: Web Fetch] Waited ${lockWaitMs}ms for Playwright lock`);
    }
    return Promise.race([
      runWebFetchInBrowser(url, offset),
      new Promise<string>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Browser fetch timed out after ${WEB_FETCH_BROWSER_TIMEOUT_MS}ms`),
            ),
          WEB_FETCH_BROWSER_TIMEOUT_MS,
        ),
      ),
    ]);
  });
}

function isPlaywrightNavigationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /execution context was destroyed|navigation|navigating/i.test(msg) ||
    /cannot read properties of null/i.test(msg)
  );
}

/** Run page JS safely — pages often redirect after domcontentloaded (Amazon, Gumroad, ads). */
async function safeExtractFromBrowserPage(page: {
  evaluate: (fn: () => unknown) => Promise<unknown>;
  content: () => Promise<string>;
  title: () => Promise<string>;
  waitForLoadState: (state: string, opts?: { timeout?: number }) => Promise<void>;
}): Promise<{ title: string; text: string }> {
  const empty = { title: '', text: '' };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        await page.waitForLoadState('load', { timeout: 12_000 }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 800));
      } else {
        await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => {});
      }
      const payload = (await page.evaluate(extractReadableContentInPage)) as {
        title?: string;
        text?: string;
      };
      const title = payload.title?.trim() ?? '';
      const text = payload.text?.trim() ?? '';
      if (text.length >= 80) {
        return { title, text };
      }
    } catch (err: unknown) {
      if (!isPlaywrightNavigationError(err) || attempt >= 2) {
        console.warn('[Tool: Web Fetch] page.evaluate failed:', err);
        break;
      }
      console.log(`[Tool: Web Fetch] Page not stable — extract retry ${attempt + 1}/2`);
    }
  }
  try {
    const html = await page.content();
    const title = (await page.title()).trim();
    const text = htmlToReadableText(html);
    if (text.length >= 80) {
      return { title, text };
    }
  } catch {
    /* fall through */
  }
  return empty;
}

async function runWebFetchInBrowser(url: string, offset: number): Promise<string> {
  return withStealthBrowser(async ({ page }: { page: any }) => {
    page.setDefaultTimeout(WEB_FETCH_NAV_TIMEOUT_MS);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: WEB_FETCH_NAV_TIMEOUT_MS });
    await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const { title: pageTitle, text: extracted } = await safeExtractFromBrowserPage(page);
    let text = extracted;

    if (text.length < 80) {
      console.log(`[Tool: Web Fetch] Page blocked or empty`);
      return formatWebFetchResult(
        url,
        'Could not extract readable content. The page may require login, CAPTCHA, or block automation. Try another URL from web_search.',
        0,
        MAX_PAGE_CHARS,
        { title: pageTitle, via: 'browser' },
      );
    }

    const formatted = formatWebFetchResult(url, text, offset, MAX_PAGE_CHARS, {
      title: pageTitle,
      via: 'browser',
    });
    console.log(`[Tool: Web Fetch] Browser readable extract (${text.length} chars)`);
    return formatted;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Plain HTTP/HTTPS GET → raw HTML. Returns null on error or empty body. */
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
  } catch (err) {
    return null;
  }
}

