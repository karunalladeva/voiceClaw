import { verifyFactsAgainstAnswer, loadFacts } from './evidence-pipeline';
import { requiresLiveLookup } from '../../agents/prompt-context';

export interface GroundingResult {
  ok: boolean;
  unverified: string[];
  shouldRetry: boolean;
}

export async function runGroundingCheck(
  scopeId: string,
  answer: string,
  query: string,
): Promise<GroundingResult> {
  const facts = await loadFacts(scopeId);
  if (facts.length === 0) {
    return { ok: true, unverified: [], shouldRetry: false };
  }
  const verified = verifyFactsAgainstAnswer(answer, facts);
  const unverified = verified.filter((f) => f.verified === false).map((f) => f.claim);
  const live = requiresLiveLookup(query);
  const ok = unverified.length === 0;
  return {
    ok,
    unverified,
    shouldRetry: !ok && live && unverified.length <= 5,
  };
}
