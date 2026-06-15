import { Agent, fetch as undiciFetch } from 'undici';

/** Default 15 min — cold model load + large tool-context prefill can exceed Node fetch defaults. */
const DEFAULT_TIMEOUT_MS = 900_000;

let sharedAgent: Agent | undefined;

function resolveTimeoutMs(): number {
  const raw = process.env.OLLAMA_REQUEST_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_TIMEOUT_MS;
}

function getAgent(): Agent {
  if (!sharedAgent) {
    const timeoutMs = resolveTimeoutMs();
    sharedAgent = new Agent({
      headersTimeout: timeoutMs <= 0 ? 0 : timeoutMs,
      bodyTimeout: timeoutMs <= 0 ? 0 : timeoutMs,
      connect: { timeout: 30_000 },
    });
  }
  return sharedAgent;
}

/** Fetch for ChatOllama with extended undici timeouts (avoids UND_ERR_HEADERS_TIMEOUT). */
export function createOllamaFetch(): typeof fetch {
  const ollamaFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as string, {
      ...init,
      dispatcher: getAgent(),
    } as Parameters<typeof undiciFetch>[1]);
  return ollamaFetch as unknown as typeof fetch;
}

export function getOllamaRequestTimeoutMs(): number {
  return resolveTimeoutMs();
}

export function isOllamaFetchTimeoutError(err: unknown): boolean {
  const cause = err instanceof Error ? (err as { cause?: unknown }).cause : undefined;
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? String((cause as { code?: string }).code)
      : '';
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed/i.test(msg) && /Headers Timeout|Body Timeout/i.test(msg);
}
