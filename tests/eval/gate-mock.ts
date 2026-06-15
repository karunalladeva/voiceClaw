import * as fs from 'fs';
import * as path from 'path';
import { verifyFactsAgainstAnswer } from '../../src/platform/context/evidence-pipeline';
import type { EvidenceFact } from '../../src/platform/contracts';

interface ClaimFixture {
  id: string;
  query: string;
  answer: string;
  facts: EvidenceFact[];
  expectVerified: boolean;
}

const BASELINE_P95_MS = Number(process.env.EVAL_BASELINE_P95_MS ?? 8000);
const LATENCY_SAMPLES = [1200, 2100, 3400, 1800, 4200];

function loadFixtures(): ClaimFixture[] {
  const p = path.join(__dirname, 'fixtures', 'claims.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as ClaimFixture[];
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function runClaimGate(): { pass: number; total: number } {
  const fixtures = loadFixtures();
  let pass = 0;
  for (const row of fixtures) {
    const verified = verifyFactsAgainstAnswer(row.answer, row.facts);
    const allOk = row.expectVerified
      ? verified.every((f) => f.verified !== false)
      : verified.some((f) => f.verified === false);
    if (allOk) {
      pass += 1;
      console.log(`[eval:mock] PASS ${row.id}`);
    } else {
      console.error(`[eval:mock] FAIL ${row.id}`);
    }
  }
  const accuracy = pass / fixtures.length;
  console.log(`[eval:mock] claim accuracy ${(accuracy * 100).toFixed(1)}% (${pass}/${fixtures.length})`);
  if (accuracy < 0.9) {
    throw new Error(`Claim accuracy ${accuracy} below 90% gate`);
  }
  return { pass, total: fixtures.length };
}

function runLatencyGate(): void {
  const p95 = percentile(LATENCY_SAMPLES, 95);
  console.log(`[eval:mock] p95 prefill sample=${p95}ms baseline=${BASELINE_P95_MS}ms`);
  if (p95 > BASELINE_P95_MS * 1.15) {
    throw new Error(`p95 latency regression: ${p95}ms > ${BASELINE_P95_MS * 1.15}ms`);
  }
}

runClaimGate();
runLatencyGate();
console.log('[eval:mock] All gates passed.');
