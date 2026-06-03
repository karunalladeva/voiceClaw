/**
 * Site-agnostic URL and HTML heuristics for web_fetch / listing enrichment.
 */

export function normalizeHostname(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

export function isSameSite(hostA: string, hostB: string): boolean {
  const a = normalizeHostname(hostA);
  const b = normalizeHostname(hostB);
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

const LISTING_PATH_RE =
  /\/(discover|browse|search|categories?|category|collections?|rankings?|charts?|leaderboard|top-?100|best-?sellers?|storefront|catalog)(\/|$)/i;

export function isListingPagePath(pathname: string): boolean {
  return LISTING_PATH_RE.test(pathname);
}

export function isCatalogLikeUrl(url: string): boolean {
  try {
    return isListingPagePath(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Common detail-page path segments (any commerce / content site). */
const DETAIL_PATH_RE =
  /\/(dp|product|products|listing|listings|item|items|p|l|sku|offer|offers|title)\/[^/?#]+/i;

export function isLikelyDetailPageUrl(url: string, baseUrl: string): boolean {
  try {
    const u = new URL(url);
    const base = new URL(baseUrl);
    if (!isSameSite(u.hostname, base.hostname)) return false;
    const path = u.pathname;
    if (isListingPagePath(path)) return false;
    if (DETAIL_PATH_RE.test(path)) return true;
    const segments = path.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    return segments.length >= 2 && last.length >= 8 && !/^(search|browse|discover)$/i.test(last);
  } catch {
    return false;
  }
}

export type UrlFetchClass = 'recommended' | 'html' | 'avoid-binary' | 'low-priority';

/** Guide web_fetch toward HTML listing/detail pages from search results (generic). */
export function classifyUrlForFetch(url: string): { class: UrlFetchClass; note: string } {
  const policyBlocked = /\.(pdf|zip|exe|dmg|epub)(\?|$)/i.test(url);
  if (policyBlocked) {
    return { class: 'avoid-binary', note: 'non-HTML file — pick an HTML page from results' };
  }
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    if (isCatalogLikeUrl(url) || /\/(zgbs|gp\/bestsellers)\//i.test(path)) {
      return { class: 'recommended', note: 'listing/catalog HTML — good for web_fetch' };
    }
    if (isLikelyDetailPageUrl(url, url)) {
      return { class: 'recommended', note: 'detail page HTML — good for web_fetch' };
    }
    if (
      /\/(blog|pulse|news|gallery|shelf\/show|business\/|ecommerce\/)/i.test(path) ||
      /\b(blog|linkedin)\b/i.test(host)
    ) {
      return { class: 'low-priority', note: 'article/roundup — snippets only unless no marketplace URL exists' };
    }
    return { class: 'html', note: 'HTML page — use web_fetch if it matches your goal' };
  } catch {
    return { class: 'html', note: 'verify URL' };
  }
}

/** HTTP body looks like nav chrome without main content (any site). */
export function isNavigationShellContent(text: string): boolean {
  const lower = text.toLowerCase();
  const shellMarkers = [
    'keyboard shortcuts',
    'skip to main content',
    'hello, sign in',
    'sign in',
    'cookie preferences',
    'accept all cookies',
  ];
  const hasShell = shellMarkers.some((m) => lower.includes(m));
  const hasSubstance =
    /#\s*\d{1,3}\b|parsed catalog signals|out of \d+ stars|ranked items|\$\d[\d,.]*/i.test(text) ||
    text.replace(/\s+/g, ' ').trim().length > 1400;
  return hasShell && !hasSubstance;
}
