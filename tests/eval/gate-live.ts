/**
 * Live eval subset — requires Ollama + running gateway.
 * Skips gracefully when OLLAMA_HOST is unreachable.
 */
import * as http from 'http';

const OLLAMA = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const GATEWAY = process.env.EVAL_GATEWAY_URL ?? 'http://127.0.0.1:3000';

async function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main(): Promise<void> {
  const ollamaOk = await probe(`${OLLAMA}/api/tags`);
  const gatewayOk = await probe(`${GATEWAY}/health`);
  if (!ollamaOk || !gatewayOk) {
    console.log('[eval:live] Skipped — Ollama or gateway not reachable.');
    process.exit(0);
  }
  console.log('[eval:live] Ollama + gateway OK — live subset not yet expanded; mock gate is authoritative on PR.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[eval:live]', err);
  process.exit(1);
});
