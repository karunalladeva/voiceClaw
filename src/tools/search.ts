import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { chromium } from 'playwright';
import * as https from 'https';
import * as http from 'http';
import { cache } from '../utils/cache';
import { requiresLiveLookup } from '../agents/prompt-context';
import { withPlaywrightLock } from '../utils/playwright-lock';


/** Max characters to read from a single page before truncating. */
const MAX_PAGE_CHARS = 4000;

const CACHE_TTL_MS = 15 * 60 * 1000;
const LIVE_CACHE_TTL_MS = 60 * 1000;
const WEB_SEARCH_NAV_TIMEOUT_MS = 15_000;
const WEB_SEARCH_TOOL_TIMEOUT_MS = 25_000;
const WEB_FETCH_TOOL_TIMEOUT_MS = 20_000;

type SearchHit = { title: string; snippet: string; url: string };

function formatSearchResults(query: string, results: SearchHit[]): string {
  const formatted = results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`)
    .join('\n\n');
  return (
    `Search results for: "${query}"\n\n` +
    formatted +
    '\n\nTip: Use the web_fetch tool with any of the URLs above to read the full page content.'
  );
}

async function searchViaDuckDuckGoHttp(query: string): Promise<SearchHit[] | null> {
  const primary = await fetchDuckDuckGoResults(query);
  if (primary && primary.length > 0) return primary;

  const simplified = query
    .replace(/\b(BSR|under\s+\d+|2024|2025|2026|high|low)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (simplified.length >= 8 && simplified.toLowerCase() !== query.toLowerCase()) {
    console.log(`[Tool: Web Search] Retrying simplified query: "${simplified}"`);
    return fetchDuckDuckGoResults(simplified);
  }
  return null;
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
  const httpResults = await searchViaDuckDuckGoHttp(query);
  if (httpResults && httpResults.length > 0) {
    console.log(`[Tool: Web Search] HTTP search succeeded (${httpResults.length} hits)`);
    return formatSearchResults(query, httpResults);
  }

  return (
    `No search results for: "${query}". ` +
    'Rephrase with simpler keywords or use web_fetch on a known marketplace URL directly. ' +
    'Do not retry the same query — proceed with available snippets or UNVALIDATED framework mode.'
  );
}


// ── web_search ────────────────────────────────────────────────────────────────

/**
 * Search the web via DuckDuckGo HTTP (with simplified-query retry).
 * Results are cached per-query for 15 minutes.
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
export const webFetchTool = tool(
  async ({ url, offset = 0 }) => {
    console.log(`[Tool: Web Fetch] Fetching (offset: ${offset}): ${url}`);

    try {
      return await Promise.race([
        runWebFetch(url, offset),
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Fetch timed out after ${WEB_FETCH_TOOL_TIMEOUT_MS}ms`)),
            WEB_FETCH_TOOL_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (e: any) {
      console.error('[Tool: Web Fetch] Failed:', e);
      return `Failed to fetch page content: ${e.message}`;
    }
  },
  {
    name: 'web_fetch',
    description:
      'Fetch and read the full text content of a web page given its URL. ' +
      'Use this after web_search to read the actual content of a result. ' +
      'Can also be used to read any URL directly (documentation, articles, etc.).',
    schema: z.object({
      url: z.string().describe('The full URL of the web page to read.'),
      offset: z.number().optional().default(0).describe('The character offset to start reading from (use for pagination).'),
    }),

  },
);

async function runWebFetch(url: string, offset: number): Promise<string> {
  if (offset > 4000) {
    return (
      `[FETCH LIMIT] Offset ${offset} exceeds allowed pagination for automated fetch. ` +
      'Use search snippets already retrieved — do not paginate further.'
    );
  }

  const plainText = await plainFetch(url);
  if (plainText && plainText.length > 200) {
    const slice = plainText.substring(offset, offset + MAX_PAGE_CHARS);
    const isTruncated = offset + MAX_PAGE_CHARS < plainText.length;
    const result =
      `CONTENT BLOCK [offset: ${offset}, length: ${slice.length}/${plainText.length}]\n` +
      slice +
      (isTruncated
        ? `\n\n...[TRUNCATED]. Prefer search snippets; avoid further pagination on this URL.]...`
        : '');
    console.log(`[Tool: Web Fetch] Plain fetch succeeded (${slice.length} chars)`);
    return result;
  }

  console.log(`[Tool: Web Fetch] Plain fetch insufficient — launching headless browser`);
  return withPlaywrightLock(async () => {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(WEB_SEARCH_NAV_TIMEOUT_MS);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: WEB_SEARCH_NAV_TIMEOUT_MS });

      await page.evaluate(() => {
        (['script', 'style', 'nav', 'header', 'footer', 'aside'] as string[]).forEach((sel) =>
          document.querySelectorAll(sel).forEach((el) => (el as any).remove()),
        );
      });

      const text: string = await page.evaluate(() => {
        const el: any =
          document.querySelector('article') ||
          document.querySelector('main') ||
          document.querySelector('[role="main"]') ||
          document.body;
        return (el?.innerText ?? '') as string;
      });

      const cleaned = text.replace(/\s{3,}/g, '\n\n').trim();
      const slice = cleaned.substring(offset, offset + MAX_PAGE_CHARS);
      const isTruncated = offset + MAX_PAGE_CHARS < cleaned.length;
      const result =
        `CONTENT BLOCK [offset: ${offset}, length: ${slice.length}/${cleaned.length}]\n` +
        slice +
        (isTruncated
          ? `\n\n...[TRUNCATED]. Prefer search snippets; avoid further pagination.]...`
          : '');
      console.log(`[Tool: Web Fetch] Browser fetch succeeded (${slice.length} chars)`);
      return result || 'No readable content found on this page.';
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Plain HTTP/HTTPS GET → raw HTML. Returns null on error or empty body. */
function plainFetchRaw(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
          timeout: 10000,
        },
        (res) => {
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            req.destroy();
            plainFetchRaw(res.headers.location).then(resolve);
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const html = Buffer.concat(chunks).toString('utf-8');
            resolve(html.length > 0 ? html : null);
          });
          res.on('error', () => resolve(null));
        },
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** Plain HTTP/HTTPS GET → stripped text. Returns null on error or empty body. */
function plainFetch(url: string): Promise<string | null> {
  return plainFetchRaw(url).then((html) => (html ? htmlToText(html) : null));
}

/** Very simple HTML → plain text stripper. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}
