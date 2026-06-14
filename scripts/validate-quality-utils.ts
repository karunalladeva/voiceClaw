/**
 * Unit-style checks for RRF, boilerplate strip, and shell content gate.
 * Run: npx ts-node scripts/validate-quality-utils.ts
 */
import { reciprocalRankFusionHits } from '../src/utils/reciprocal-rank-fusion';
import { stripMarkdownBoilerplate } from '../src/utils/markdown-cleanup';
import { isNavigationShellContent } from '../src/tools/web-heuristics';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function testRrf(): void {
  const a = [{ url: 'https://a.com', title: 'A' }];
  const b = [{ url: 'https://b.com', title: 'B' }, { url: 'https://a.com', title: 'A2' }];
  const fused = reciprocalRankFusionHits([a, b], 60);
  assert(fused[0]?.url === 'https://a.com', 'RRF should rank URL appearing in both lists first');
  assert(fused.length === 2, 'RRF should dedupe URLs');
  console.log('[PASS] reciprocalRankFusionHits');
}

function testBoilerplateStrip(): void {
  const input = '# Title\n\nReal content about pricing $9.99\n\nAccept all cookies\nShare on Facebook';
  const { text, removedLines } = stripMarkdownBoilerplate(input);
  assert(text.includes('Real content'), 'Should keep substance');
  assert(!text.includes('Accept all cookies'), 'Should remove cookie line');
  assert(removedLines >= 1, 'Should count removed lines');
  console.log('[PASS] stripMarkdownBoilerplate');
}

function testShellGate(): void {
  const shell = 'Hello, sign in\nKeyboard shortcuts\nSkip to main content\n';
  assert(isNavigationShellContent(shell), 'Pure shell should be detected');
  const substance =
    '# 1 Bestseller\nParsed catalog signals\nOut of 5 stars\n' + 'x'.repeat(1500);
  assert(!isNavigationShellContent(substance), 'Substantive page should pass gate');
  console.log('[PASS] isNavigationShellContent');
}

function main(): void {
  testRrf();
  testBoilerplateStrip();
  testShellGate();
  console.log('\n=== PASS: quality utils validated ===');
}

main();
