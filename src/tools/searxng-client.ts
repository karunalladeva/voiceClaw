/** Local SearXNG instance (Docker) — configured via workspace/config.json and admin settings. */

import { configManager } from '../config/index';

const PROBE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;
const SEARCH_TIMEOUT_MS = 10_000;
export const MAX_SEARXNG_RESULTS = 15;

export type SearxngSearchHit = {
  title: string;
  url: string;
  snippet: string;
  source_engine?: string;
  score?: number;
  publishedDate?: string;
};

export type SearxngHealthStatus = {
  enabled: boolean;
  reachable: boolean;
  baseUrl: string;
  details: string;
};

let cachedAvailable: boolean | null = null;
let lastProbeAt = 0;

export function invalidateSearxngProbeCache(): void {
  cachedAvailable = null;
  lastProbeAt = 0;
}

export function getSearxngBaseUrl(): string {
  return configManager.getSearxngBaseUrl();
}

export function isSearxngEnabledByConfig(): boolean {
  return configManager.getConfig().searxng.enabled;
}

export function isSearxngAvailable(): boolean {
  return cachedAvailable === true;
}

export async function searxngHealthCheck(): Promise<SearxngHealthStatus> {
  const baseUrl = getSearxngBaseUrl();
  if (!isSearxngEnabledByConfig()) {
    return {
      enabled: false,
      reachable: false,
      baseUrl,
      details: 'SearXNG disabled in settings (fallbacks per webSearch config).',
    };
  }
  const reachable = await probeSearxngAvailability(true);
  return {
    enabled: true,
    reachable,
    baseUrl,
    details: reachable
      ? 'SearXNG search API responding — primary web_search provider.'
      : `Cannot reach SearXNG at ${baseUrl}. Check Docker and base URL.`,
  };
}

export async function probeSearxngAvailability(force = false): Promise<boolean> {
  if (!isSearxngEnabledByConfig()) {
    cachedAvailable = false;
    return false;
  }

  const now = Date.now();
  if (!force && cachedAvailable !== null && now - lastProbeAt < PROBE_TTL_MS) {
    return cachedAvailable;
  }

  const base = getSearxngBaseUrl();
  try {
    const url = new URL('/search', base);
    url.searchParams.set('q', 'health');
    url.searchParams.set('format', 'json');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      cachedAvailable = false;
    } else {
      const data = (await res.json()) as { results?: unknown };
      cachedAvailable = Array.isArray(data.results);
    }
  } catch {
    cachedAvailable = false;
  }

  lastProbeAt = now;
  if (cachedAvailable) {
    console.log(`[SearXNG] Available at ${base} (primary web_search provider)`);
  } else if (force) {
    console.log(`[SearXNG] Unavailable at ${base} — web_search will use configured fallbacks`);
  }
  return cachedAvailable;
}

type SearxngRawResult = {
  title?: string;
  url?: string;
  content?: string;
  engine?: string;
  engines?: string[];
  score?: number;
  publishedDate?: string;
  pubdate?: string;
};

function parseUnresponsiveEngines(raw: unknown): Set<string> {
  const dead = new Set<string>();
  if (!Array.isArray(raw)) return dead;
  for (const entry of raw) {
    if (Array.isArray(entry) && entry.length >= 1) {
      const name = String(entry[0]).trim();
      if (name) dead.add(name);
    } else if (entry && typeof entry === 'object' && 'name' in entry) {
      const name = String((entry as { name?: string }).name ?? '').trim();
      if (name) dead.add(name);
    }
  }
  return dead;
}

function hitFromUnresponsiveEngines(hit: SearxngRawResult, dead: Set<string>): boolean {
  if (dead.size === 0) return false;
  const engines = hit.engines?.length
    ? hit.engines.map((e) => e.trim()).filter(Boolean)
    : hit.engine
      ? [hit.engine.trim()]
      : [];
  if (engines.length === 0) {
    return hit.engine ? dead.has(hit.engine.trim()) : false;
  }
  return engines.every((e) => dead.has(e));
}

function parsePublishedDate(r: SearxngRawResult): string | undefined {
  const raw = r.publishedDate ?? r.pubdate;
  if (!raw) return undefined;
  const s = String(raw).trim();
  return s || undefined;
}

function sortHits(hits: SearxngSearchHit[]): SearxngSearchHit[] {
  return [...hits].sort((a, b) => {
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    if (sb !== sa) return sb - sa;
    const da = a.publishedDate ? Date.parse(a.publishedDate) : 0;
    const db = b.publishedDate ? Date.parse(b.publishedDate) : 0;
    return db - da;
  });
}

export type SearxngSearchOptions = {
  timeRange?: string;
};

export async function searchSearxng(
  query: string,
  options?: SearxngSearchOptions,
): Promise<SearxngSearchHit[] | null> {
  if (!isSearxngAvailable()) return null;

  const base = getSearxngBaseUrl();
  const url = new URL('/search', base);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');

  const cfg = configManager.getConfig().searxng;
  const categories = cfg.categories?.trim();
  if (categories) url.searchParams.set('categories', categories);

  const timeRange = (options?.timeRange ?? cfg.timeRange)?.trim();
  if (timeRange) url.searchParams.set('time_range', timeRange);

  const language = cfg.language?.trim() || 'en';
  if (language) url.searchParams.set('language', language);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[SearXNG] Search HTTP ${res.status} for: "${query}"`);
      return null;
    }

    const data = (await res.json()) as {
      results?: SearxngRawResult[];
      unresponsive_engines?: unknown;
    };
    const dead = parseUnresponsiveEngines(data.unresponsive_engines);
    if (dead.size > 0) {
      console.log(`[SearXNG] Filtered results from unresponsive engines: ${[...dead].join(', ')}`);
    }

    const raw = (data.results ?? []).filter((r) => !hitFromUnresponsiveEngines(r, dead));
    const hits: SearxngSearchHit[] = raw
      .map((r) => ({
        title: (r.title ?? '').trim(),
        url: (r.url ?? '').trim(),
        snippet: (r.content ?? '').replace(/\s+/g, ' ').trim(),
        source_engine: r.engine?.trim() || undefined,
        score: typeof r.score === 'number' ? r.score : undefined,
        publishedDate: parsePublishedDate(r),
      }))
      .filter((r) => r.title && r.url);

    const sorted = sortHits(hits).slice(0, MAX_SEARXNG_RESULTS);
    return sorted.length > 0 ? sorted : null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[SearXNG] Search failed: ${msg}`);
    return null;
  }
}
