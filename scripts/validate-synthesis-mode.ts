/**
 * Smoke tests for pipeline follow-up synthesis detection.
 * Run: npx tsx scripts/validate-synthesis-mode.ts
 */
import {
  isFollowUpOverProvidedHistory,
  isStandaloneLiveTradingQuery,
  shouldUseSynthesisMode,
} from '../src/agents/prompt-context';

const pipelineHistory =
  '[Pipeline Output] Tech Sector Report\nRecommendation: BUY\nCurrent Price: $490';

type Case = { name: string; query: string; history: string; expected: boolean };

const cases: Case[] = [
  {
    name: 'table view + pipeline history',
    query: 'Give table view current price | buy | sell | why',
    history: pipelineHistory,
    expected: true,
  },
  {
    name: 'format as table + pipeline history',
    query: 'Format the report as a table',
    history: pipelineHistory,
    expected: true,
  },
  {
    name: 'buy/sell standalone + pipeline history',
    query: 'Should I buy or sell AAPL',
    history: pipelineHistory,
    expected: false,
  },
  {
    name: 'buy/sell signals + empty history',
    query: 'buy/sell signals for NVDA',
    history: '',
    expected: false,
  },
  {
    name: 'explicit live refresh + pipeline history',
    query: 'What is the latest price of TSLA right now',
    history: pipelineHistory,
    expected: false,
  },
  {
    name: 'embedded yahoo synthesis in query',
    query: 'Summarize ## Market data for AMD (Yahoo Finance)\n### Price',
    history: '',
    expected: true,
  },
];

let passed = 0;
let failed = 0;

for (const c of cases) {
  const actual = shouldUseSynthesisMode(c.query, c.history || undefined);
  const ok = actual === c.expected;
  if (ok) {
    passed++;
    console.log(`OK  ${c.name}`);
  } else {
    failed++;
    console.error(`FAIL ${c.name}: expected ${c.expected}, got ${actual}`);
  }
}

console.log(`\nStandalone live trading: Should I buy or sell AAPL => ${isStandaloneLiveTradingQuery('Should I buy or sell AAPL')}`);
console.log(
  `Follow-up: table + history => ${isFollowUpOverProvidedHistory('Give table view current price | buy | sell | why', pipelineHistory)}`,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
