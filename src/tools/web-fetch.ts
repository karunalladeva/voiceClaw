import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { cache } from '../utils/cache';
import { getAgentRunContext } from '../agents/agent-run-context';
import { evaluateFetchUrlPolicy } from './web-url-policy';
import { checkUrlReachability } from './web-url-reachability';
import { fetchPageMarkdown } from './web-page-fetch';
import { packMarkdownForQuery, queryFromTitle } from '../utils/query-aware-truncate';
import { configManager } from '../config/index';
import { isNavigationShellContent } from './web-heuristics';
import { expandRankingQuery, marketplaceHintTokens } from '../utils/query-expansion';

const WEB_FETCH_TOOL_TIMEOUT_MS = 90_000;
const WEB_FETCH_CACHE_TTL_MS = 15 * 60 * 1000;

type FullFetchCache = {
  fullMarkdown: string;
  title: string;
  cleanupRemovedChars?: number;
};

function isSkillToolCancelled(): boolean {
  return getAgentRunContext()?.skillRunCancelled === true;
}

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return u.href.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function resolveBm25Query(opts: {
  query?: string;
  focus?: string;
  title?: string;
}): string {
  const runCtx = getAgentRunContext();
  const explicit = opts.query?.trim() || opts.focus?.trim();
  const cfg = configManager.getConfig().webFetch;
  if (cfg.expandRankingQuery !== false) {
    const expanded = expandRankingQuery([
      explicit,
      runCtx?.lastWebSearchQuery,
      runCtx?.lastUserQuery,
      opts.title ? queryFromTitle(opts.title) : '',
      marketplaceHintTokens(runCtx?.lastUserQuery),
    ]);
    if (expanded) return expanded;
  }
  if (explicit) return explicit;
  if (runCtx?.lastWebSearchQuery?.trim()) return runCtx.lastWebSearchQuery.trim();
  if (runCtx?.lastUserQuery?.trim()) return runCtx.lastUserQuery.trim();
  return '';
}

function fetchDedupeKey(url: string, part: number, focus?: string, query?: string): string {
  const f = (focus ?? '').trim().toLowerCase();
  const q = (query ?? '').trim().toLowerCase();
  return `${normalizeUrlKey(url)}|p${part}|f:${f}|q:${q}`;
}

function registerFetchDedupe(url: string, part: number, focus?: string, query?: string): string | null {
  const runCtx = getAgentRunContext();
  if (!runCtx?.orgTaskId) return null;
  const key = fetchDedupeKey(url, part, focus, query);
  if (!runCtx.webFetchKeys) runCtx.webFetchKeys = new Set();
  if (runCtx.webFetchKeys.has(key)) {
    return (
      `Duplicate web_fetch skipped for this task (already ran): ${url} part=${part}. ` +
      'Use a different part, focus, query, or URL from web_search.'
    );
  }
  runCtx.webFetchKeys.add(key);
  return null;
}

function formatFetchOutput(
  url: string,
  title: string,
  body: string,
  meta: {
    part: number;
    totalParts: number;
    rankingMode: string;
    queryUsed: string;
    totalChars: number;
    bridgeOverlapChars: number;
    confidence?: string;
    cleanupRemovedChars?: number;
    queryExpanded?: boolean;
  },
): string {
  const header = [
    '# Web page content',
    `URL: ${url}`,
    title ? `Title: ${title}` : null,
    'Source: impit+readability',
    meta.confidence ? `Confidence: ${meta.confidence}` : null,
    meta.cleanupRemovedChars && meta.cleanupRemovedChars > 0
      ? `Cleanup: removed ${meta.cleanupRemovedChars} chars boilerplate`
      : null,
    `Chars: ${body.length}/${meta.totalChars}`,
    meta.rankingMode !== 'none' ? `Ranking: ${meta.rankingMode}` : null,
    meta.queryUsed
      ? `Query: ${meta.queryUsed}${meta.queryExpanded ? ' (expanded)' : ''}`
      : null,
    meta.part > 0 || meta.totalParts > 1 ? `Part: ${meta.part + 1}/${meta.totalParts}` : null,
    meta.bridgeOverlapChars > 0 ? `Overlap: ${meta.bridgeOverlapChars} chars bridged from prior part` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `${header}\n\n---\n\n${body}`;
}

async function getFullMarkdown(url: string): Promise<FullFetchCache> {
  const cacheKey = `fetch:full:${normalizeUrlKey(url)}`;
  const cached = await cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as FullFetchCache;
    } catch {
      /* refetch */
    }
  }
  const page = await fetchPageMarkdown(url);
  const entry: FullFetchCache = {
    fullMarkdown: page.fullMarkdown,
    title: page.title,
    cleanupRemovedChars: page.cleanupRemovedChars,
  };
  await cache.set(cacheKey, JSON.stringify(entry), WEB_FETCH_CACHE_TTL_MS);
  return entry;
}

export async function runWebFetch(
  url: string,
  part: number,
  focus?: string,
  query?: string,
): Promise<string> {
  const policy = evaluateFetchUrlPolicy(url);
  if (!policy.allowed) {
    return `Failed to read the webpage. ${policy.reason}`;
  }

  const reachability = await checkUrlReachability(url);
  if (!reachability.reachable) {
    return `Failed to read the webpage. ${reachability.reason} Try the next URL from web_search results.`;
  }

  let effectiveQuery = resolveBm25Query({ query, focus });
  const memoKey = `fetch:out:${normalizeUrlKey(url)}:p${part}:q:${effectiveQuery.slice(0, 80)}`;
  const memo = await cache.get(memoKey);
  if (memo) {
    return memo;
  }

  const full = await getFullMarkdown(url);

  const cfg = configManager.getConfig().webFetch;
  if (cfg.rejectShellContent !== false && isNavigationShellContent(full.fullMarkdown)) {
    return formatFetchOutput(
      url,
      full.title,
      'Confidence: LOW — page looks like navigation shell (sign-in/cookie chrome) with little substance. Try the next URL from web_search.',
      {
        part,
        totalParts: 1,
        rankingMode: 'rejected',
        queryUsed: effectiveQuery,
        totalChars: full.fullMarkdown.length,
        bridgeOverlapChars: 0,
        confidence: 'LOW',
        cleanupRemovedChars: full.cleanupRemovedChars,
      },
    );
  }

  const queryExpanded = cfg.expandRankingQuery !== false;
  if (!effectiveQuery) {
    effectiveQuery = resolveBm25Query({ query, focus, title: full.title });
  } else if (queryExpanded && !query?.trim() && !focus?.trim()) {
    effectiveQuery = resolveBm25Query({ query, focus, title: full.title });
  }

  const priorPartKey =
    part > 0 ? `fetch:out:${normalizeUrlKey(url)}:p${part - 1}:q:${effectiveQuery.slice(0, 80)}` : null;
  const priorPartText = priorPartKey ? await cache.get(priorPartKey) : null;
  const priorBody = priorPartText?.split('\n\n---\n\n').slice(1).join('\n\n---\n\n') ?? null;

  const packed = await packMarkdownForQuery(full.fullMarkdown, effectiveQuery, part, priorBody);
  const substance = full.fullMarkdown.replace(/\s+/g, ' ').trim().length;
  const confidence = substance > 1400 ? 'HIGH' : 'MEDIUM';
  const result = formatFetchOutput(url, full.title, packed.text, {
    part: packed.partIndex,
    totalParts: packed.totalParts,
    rankingMode: packed.rankingMode,
    queryUsed: packed.queryUsed,
    totalChars: full.fullMarkdown.length,
    bridgeOverlapChars: packed.bridgeOverlapChars,
    confidence,
    cleanupRemovedChars: full.cleanupRemovedChars,
    queryExpanded,
  });

  await cache.set(memoKey, result, WEB_FETCH_CACHE_TTL_MS);
  return result;
}

export const webFetchTool = tool(
  async ({ url, part = 0, focus, query }) => {
    if (isSkillToolCancelled()) {
      return 'Fetch skipped — skill run already ended (tool limit or timeout).';
    }

    const duplicate = registerFetchDedupe(url, part, focus, query);
    if (duplicate) return duplicate;

    console.log(`[Tool: Web Fetch] url=${url} part=${part} focus=${focus ?? ''} query=${query ?? ''}`);

    try {
      const result = await Promise.race([
        runWebFetch(url, part, focus, query),
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Fetch timed out after ${WEB_FETCH_TOOL_TIMEOUT_MS}ms`)),
            WEB_FETCH_TOOL_TIMEOUT_MS,
          ),
        ),
      ]);
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Tool: Web Fetch] Failed:', e);
      return `Failed to read the webpage. Error: ${msg}. Try the next URL from web_search results.`;
    }
  },
  {
    name: 'web_fetch',
    description:
      'Fetch readable markdown from an HTML page URL (from web_search). Uses stealth HTTP + Readability. ' +
      'For long pages use part=1,2,… or focus/query for BM25-ranked sections. Does not support PDF/binary.',
    schema: z.object({
      url: z.string().describe('Full HTML page URL from web_search (not .pdf or binary).'),
      part: z.number().optional().default(0).describe('Chunk window index for long pages (0, 1, 2, …).'),
      focus: z.string().optional().describe('Optional sub-topic for BM25 chunk ranking on this URL.'),
      query: z
        .string()
        .optional()
        .describe('Optional BM25 query override (defaults to last search or user question).'),
    }),
  },
);
