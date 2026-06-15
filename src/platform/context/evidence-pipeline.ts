import * as fs from 'fs/promises';
import * as path from 'path';
import type { EvidenceFact, EvidenceBundle } from '../contracts';
import { scopeStoreDir } from '../session/scope-id';

function factsPath(scopeId: string): string {
  return path.join(process.cwd(), 'workspace', 'session-store', scopeStoreDir(scopeId), 'facts.jsonl');
}

export async function appendFacts(scopeId: string, facts: EvidenceFact[]): Promise<void> {
  const p = factsPath(scopeId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const lines = facts.map((f) => JSON.stringify(f)).join('\n') + '\n';
  await fs.appendFile(p, lines, 'utf-8');
}

export async function loadFacts(scopeId: string): Promise<EvidenceFact[]> {
  try {
    const raw = await fs.readFile(factsPath(scopeId), 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EvidenceFact);
  } catch {
    return [];
  }
}

export function extractFactsFromToolOutput(
  scopeId: string,
  toolName: string,
  body: string,
  pointerId?: string,
): EvidenceFact[] {
  const lines = body.split('\n').slice(0, 40);
  const facts: EvidenceFact[] = [];
  const now = new Date().toISOString();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 12 || trimmed.length > 400) continue;
    if (!/\d/.test(trimmed) && toolName.includes('market')) continue;
    facts.push({
      id: `${Date.now()}-${facts.length}`,
      claim: trimmed.slice(0, 240),
      source: toolName,
      pointerId,
      fetchedAt: now,
      verified: false,
    });
    if (facts.length >= 12) break;
  }
  return facts;
}

export async function buildEvidenceBundle(scopeId: string): Promise<EvidenceBundle> {
  const facts = await loadFacts(scopeId);
  return { scopeId, facts, createdAt: new Date().toISOString() };
}

export function verifyFactsAgainstAnswer(answer: string, facts: EvidenceFact[]): EvidenceFact[] {
  return facts.map((f) => {
    const nums = f.claim.match(/\d[\d.,]*/g) ?? [];
    const verified = nums.length === 0 || nums.some((n) => answer.includes(n.replace(/,/g, '')));
    return { ...f, verified };
  });
}
