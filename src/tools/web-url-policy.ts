/**
 * Generic URL rules for web_fetch — no vendor or product names.
 */

const BLOCKED_EXTENSIONS = ['.pdf', '.zip', '.exe', '.dmg', '.epub'];

export type UrlPolicyResult = { allowed: true } | { allowed: false; reason: string };

export function evaluateFetchUrlPolicy(url: string): UrlPolicyResult {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { allowed: false, reason: 'Only http(s) URLs are supported.' };
    }
    const pathLower = parsed.pathname.toLowerCase();
    for (const ext of BLOCKED_EXTENSIONS) {
      if (pathLower.endsWith(ext) || pathLower.includes(`${ext}?`)) {
        return {
          allowed: false,
          reason: `Binary or non-HTML resource (${ext}) — use an HTML page URL from web_search instead.`,
        };
      }
    }
    return { allowed: true };
  } catch {
    return { allowed: false, reason: 'Invalid URL.' };
  }
}

export function normalizeSearchQueryKey(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}
