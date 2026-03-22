import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { chromium } from 'playwright';
import * as https from 'https';
import * as http from 'http';
import { cache } from '../utils/cache';


/** Max characters to read from a single page before truncating. */
const MAX_PAGE_CHARS = 4000;

const CACHE_TTL_MS = 15 * 60 * 1000;


// ── web_search ────────────────────────────────────────────────────────────────

/**
 * Search the web via Yahoo (headless browser scrape).
 * Results are cached per-query for 15 minutes — matching OpenClaw's approach.
 * Pair with web_fetch to read the content of any result URL.
 */
export const webSearchTool = tool(
  async ({ query }) => {
    const cacheKey = `search:${query.toLowerCase().trim()}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[Tool: Web Search] Cache hit for: "${query}"`);
      return cached;
    }


    let browser;
    try {
      console.log(`[Tool: Web Search] Searching via Browser for: "${query}"`);


      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      await page.goto(`https://search.yahoo.com/search?p=${encodeURIComponent(query)}`);
      await page.waitForTimeout(2000);

      const results: { title: string; snippet: string; url: string }[] = await page.$$eval(
        '.algo',
        (elements) =>
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

      await browser.close();
      browser = undefined;

      if (!results || results.length === 0) {
        return 'No results found for this query.';
      }

      const formatted = results
        .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`)
        .join('\n\n');

      const result = (
        `Search results for: "${query}"\n\n` +
        formatted +
        '\n\nTip: Use the web_fetch tool with any of the URLs above to read the full page content.'
      );

      await cache.set(cacheKey, result, CACHE_TTL_MS);
      return result;
    } catch (e: any) {
      if (browser) await browser.close().catch(() => {});
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


    // 1. Try plain HTTP first (fast, no Playwright overhead)
    const plainText = await plainFetch(url);
    if (plainText && plainText.length > 200) {
      const slice = plainText.substring(offset, offset + MAX_PAGE_CHARS);
      const isTruncated = (offset + MAX_PAGE_CHARS) < plainText.length;
      
      const result = (
        `CONTENT BLOCK [offset: ${offset}, length: ${slice.length}/${plainText.length}]\n` +
        slice +
        (isTruncated ? `\n\n...[TRUNCATED]. Use web_fetch with offset ${offset + MAX_PAGE_CHARS} to read more.` : '')
      );
      
      console.log(`[Tool: Web Fetch] Plain fetch succeeded (${slice.length} chars)`);
      return result;
    }


    // 2. Fall back to headless browser for JS-heavy sites
    console.log(`[Tool: Web Fetch] Plain fetch insufficient — launching headless browser`);
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

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

      await browser.close();

      const cleaned = text.replace(/\s{3,}/g, '\n\n').trim();
      const slice = cleaned.substring(offset, offset + MAX_PAGE_CHARS);
      const isTruncated = (offset + MAX_PAGE_CHARS) < cleaned.length;

      const result = (
        `CONTENT BLOCK [offset: ${offset}, length: ${slice.length}/${cleaned.length}]\n` +
        slice +
        (isTruncated ? `\n\n...[TRUNCATED]. Use web_fetch with offset ${offset + MAX_PAGE_CHARS} to read more.` : '')
      );

      console.log(`[Tool: Web Fetch] Browser fetch succeeded (${slice.length} chars)`);
      return result || 'No readable content found on this page.';

    } catch (e: any) {
      if (browser) await browser.close().catch(() => {});
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Plain HTTP/HTTPS GET → stripped text. Returns null on error or empty body. */
function plainFetch(url: string): Promise<string | null> {
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
          // Follow one redirect
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            req.destroy();
            plainFetch(res.headers.location).then(resolve);
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const html = Buffer.concat(chunks).toString('utf-8');
            resolve(htmlToText(html));
          });
          res.on('error', () => resolve(null));
        },
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch {
      resolve(null);
    }
  });
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
