/**
 * Validates web_search and web_fetch end-to-end (SearXNG → Impit fetch).
 * Run: npx ts-node scripts/validate-web-tools.ts
 */
import dotenv from 'dotenv';
import { configManager } from '../src/config/index';
import {
  invalidateSearxngProbeCache,
  probeSearxngAvailability,
  searxngHealthCheck,
} from '../src/tools/searxng-client';
import { webSearchTool, webFetchTool } from '../src/tools/search';

dotenv.config();

const SEARCH_QUERY = 'voice assistant open source github';

function extractFirstUrl(searchOutput: string): string | null {
  const match = searchOutput.match(/^URL:\s*(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function summarize(label: string, text: string, maxLines = 12): void {
  const lines = text.split('\n').slice(0, maxLines);
  console.log(`\n--- ${label} (${text.length} chars) ---`);
  console.log(lines.join('\n'));
  if (text.split('\n').length > maxLines) console.log('...');
}

async function main(): Promise<void> {
  console.log('=== Web tools validation ===\n');

  await configManager.initialize();
  invalidateSearxngProbeCache();
  const health = await searxngHealthCheck();
  console.log('[SearXNG config]', {
    enabled: health.enabled,
    reachable: health.reachable,
    baseUrl: health.baseUrl,
    details: health.details,
  });

  const probeOk = await probeSearxngAvailability(true);
  console.log('[SearXNG probe]', probeOk ? 'OK' : 'FAILED');

  const searchStart = Date.now();
  let searchOut: string;
  try {
    searchOut = String(await webSearchTool.execute({ query: SEARCH_QUERY }));
  } catch (e: unknown) {
    console.error('\n[FAIL] web_search threw:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
  const searchMs = Date.now() - searchStart;

  const searchFailed =
    searchOut.includes('Failed to search') ||
    searchOut.startsWith('No search results') ||
    searchOut.includes('Duplicate search skipped');
  const hasResults = /\[1\]/.test(searchOut) && /URL:/.test(searchOut);
  const usedSearx = /Engine:/.test(searchOut);
  const hasScore = /Score:/.test(searchOut);
  const hasConfidence = /Confidence:\s*LOW/i.test(searchOut);
  const hasRrfHint = /Merged:\s*RRF/i.test(searchOut);

  console.log('\n[web_search]', {
    durationMs: searchMs,
    pass: !searchFailed && hasResults,
    providerHint: usedSearx ? 'SearXNG' : 'fallback (no Engine: lines)',
    hasScore,
    hasConfidence,
    hasRrfHint,
    resultCount: (searchOut.match(/^\[\d+\]/gm) ?? []).length,
  });
  summarize('web_search output', searchOut);

  if (!hasResults) {
    console.error('\n[FAIL] web_search returned no usable results');
    process.exit(1);
  }

  const fetchUrl = extractFirstUrl(searchOut);
  if (!fetchUrl) {
    console.error('\n[FAIL] Could not parse URL from search output');
    process.exit(1);
  }
  console.log('\n[web_fetch] target:', fetchUrl);

  const fetchStart = Date.now();
  let fetchOut: string;
  try {
    fetchOut = String(await webFetchTool.execute({ url: fetchUrl, part: 0 }));
  } catch (e: unknown) {
    console.error('\n[FAIL] web_fetch threw:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
  const fetchMs = Date.now() - fetchStart;

  const fetchFailed =
    fetchOut.startsWith('Failed to read') ||
    fetchOut.includes('Extraction failed') ||
    fetchOut.includes('Duplicate web_fetch');
  const hasBody =
    fetchOut.length > 400 &&
    !fetchFailed &&
    fetchOut.includes('Source: impit+readability');
  const hasFetchConfidence = /Confidence:\s*(MEDIUM|HIGH|LOW)/i.test(fetchOut);

  console.log('\n[web_fetch]', {
    durationMs: fetchMs,
    pass: hasBody,
    chars: fetchOut.length,
    hasFetchConfidence,
  });
  summarize('web_fetch output', fetchOut);

  if (!hasBody) {
    console.error('\n[FAIL] web_fetch did not return readable markdown');
    process.exit(1);
  }

  console.log('\n=== PASS: web_search and web_fetch validated ===');
  console.log('Run scripts/validate-quality-utils.ts for RRF/strip/gate unit checks.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
