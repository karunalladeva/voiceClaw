import { Impit } from 'impit';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { configManager } from '../config/index';
import { enrichCatalogHtml } from './web-listing-parser';
import { isCatalogLikeUrl } from './web-heuristics';

const RETRY_STATUSES = new Set([403, 429, 502, 503]);
const MAX_RETRIES = 2;
const BACKOFF_MS = [1000, 3000];

let impitInstance: Impit | null = null;

function getImpit(): Impit {
  if (!impitInstance) {
    const cfg = configManager.getConfig().webFetch;
    impitInstance = new Impit({
      browser: 'chrome',
      ignoreTlsErrors: cfg.ignoreTlsErrors,
      ...(cfg.proxyUrl?.trim() ? { proxyUrl: cfg.proxyUrl.trim() } : {}),
    });
  }
  return impitInstance;
}

export function resetImpitClient(): void {
  impitInstance = null;
}

async function fetchHtmlWithRetry(url: string): Promise<{ html: string; status: number }> {
  const impit = getImpit();
  let lastStatus = 0;
  let lastError = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1] ?? 3000));
    }
    try {
      const response = await impit.fetch(url);
      lastStatus = response.status;
      if (response.ok) {
        const html = await response.text();
        return { html, status: response.status };
      }
      if (!RETRY_STATUSES.has(response.status) || attempt >= MAX_RETRIES) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      lastError = `HTTP ${response.status}`;
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt >= MAX_RETRIES) throw new Error(lastError);
    }
  }
  throw new Error(lastError || `HTTP ${lastStatus}`);
}

function turndownHtml(html: string, baseUrl: string): string {
  const td = new TurndownService();
  return td.turndown(html);
}

function extractViaReadability(html: string, url: string): { title: string; markdown: string } | null {
  const doc = new JSDOM(html, { url });
  const reader = new Readability(doc.window.document);
  const article = reader.parse();
  if (!article?.content) return null;
  const title = article.title?.trim() ?? '';
  const markdown = turndownHtml(article.content, url).trim();
  if (markdown.length < 80) return null;
  return { title, markdown };
}

function extractViaMainFallback(html: string, url: string): { title: string; markdown: string } | null {
  const doc = new JSDOM(html, { url });
  const root =
    doc.window.document.querySelector('main') ??
    doc.window.document.querySelector('article') ??
    doc.window.document.querySelector('[role="main"]');
  if (!root) return null;
  const title = doc.window.document.title?.trim() ?? '';
  const markdown = turndownHtml(root.innerHTML, url).trim();
  if (markdown.length < 80) return null;
  return { title, markdown };
}

function extractPlainFallback(html: string, url: string): { title: string; markdown: string } {
  const doc = new JSDOM(html, { url });
  const title = doc.window.document.title?.trim() ?? url;
  const text = doc.window.document.body?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const slice = text.slice(0, 2000);
  return {
    title,
    markdown: slice.length > 0 ? slice : 'Extraction failed — try another URL from web_search.',
  };
}

export type PageMarkdownResult = {
  title: string;
  markdown: string;
  fullMarkdown: string;
};

export async function fetchPageMarkdown(url: string): Promise<PageMarkdownResult> {
  console.log(`[Tool: Web Fetch] Impit fetching: ${url}`);
  const { html } = await fetchHtmlWithRetry(url);

  let extracted = extractViaReadability(html, url);
  if (!extracted) {
    console.log('[Tool: Web Fetch] Readability empty — trying main/article fallback');
    extracted = extractViaMainFallback(html, url);
  }

  if (!extracted && isCatalogLikeUrl(url)) {
    const catalog = enrichCatalogHtml(html, url);
    if (catalog && catalog.length >= 80) {
      extracted = { title: new JSDOM(html, { url }).window.document.title?.trim() ?? url, markdown: catalog };
    }
  }

  if (!extracted) {
    console.log('[Tool: Web Fetch] Extraction failed — plain text fallback');
    extracted = extractPlainFallback(html, url);
  }

  return {
    title: extracted.title,
    markdown: extracted.markdown,
    fullMarkdown: extracted.markdown,
  };
}
