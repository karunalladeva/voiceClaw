import dns from 'node:dns/promises';

export type UrlReachability = { reachable: true } | { reachable: false; reason: string };

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url.trim()).hostname || null;
  } catch {
    return null;
  }
}

/** DNS preflight — catches invented or mistyped hostnames before HTTP/browser work. */
export async function checkUrlReachability(url: string): Promise<UrlReachability> {
  const hostname = hostnameFromUrl(url);
  if (!hostname) {
    return { reachable: false, reason: 'Invalid URL — no hostname.' };
  }
  try {
    await dns.lookup(hostname);
    return { reachable: true };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return {
        reachable: false,
        reason:
          `Hostname "${hostname}" does not resolve (DNS). ` +
          'Use an exact URL from web_search — do not guess domains or merge paths from other sites.',
      };
    }
    if (code === 'EAI_AGAIN') {
      return {
        reachable: false,
        reason: `Temporary DNS failure for "${hostname}". Retry or pick another URL from web_search.`,
      };
    }
    return { reachable: true };
  }
}

export function isPlaywrightNetworkError(message: string): boolean {
  return /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_TIMED_OUT|ERR_SSL|ERR_CERT|net::ERR_/i.test(
    message,
  );
}

export function formatPlaywrightNetworkFailure(url: string, message: string): string {
  const host = hostnameFromUrl(url) ?? url;
  if (/ERR_NAME_NOT_RESOLVED/i.test(message)) {
    return (
      `Could not resolve "${host}". ` +
      'The domain is likely wrong — copy a URL verbatim from web_search results.'
    );
  }
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_TIMED_OUT/i.test(message)) {
    return `Could not connect to "${host}". Try another URL from web_search.`;
  }
  return `Navigation failed: ${message.split('\n')[0].trim()}`;
}
