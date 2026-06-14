import type { BaseMessage } from '@langchain/core/messages';
import { configManager } from '../config/index';
import { bm25RankIndices } from '../utils/bm25';
import { rankTextsByEmbedding } from '../utils/embedding-rank';

export type HistoryContextRanking = 'recency' | 'bm25' | 'embedding';

export interface HistoryCandidate {
  index: number;
  message: BaseMessage;
  text: string;
  chars: number;
}

export function getHistoryContextConfig(): {
  ranking: HistoryContextRanking;
  embedModel: string;
  embedBaseUrl: string;
  minRecentTurns: number;
} {
  const agent = configManager.getConfig().agent;
  const hc = agent.historyContext;
  const wf = configManager.getConfig().webFetch;
  return {
    ranking: hc?.ranking ?? 'recency',
    embedModel: hc?.embedModel?.trim() || wf.embedModel,
    embedBaseUrl: hc?.embedBaseUrl?.trim() || wf.embedBaseUrl,
    minRecentTurns: Math.max(0, hc?.minRecentTurns ?? 2),
  };
}

async function rankCandidateIndices(
  candidates: HistoryCandidate[],
  query: string,
): Promise<number[]> {
  const cfg = getHistoryContextConfig();
  const docs = candidates.map((c) => c.text);
  if (cfg.ranking === 'embedding') {
    const ranked = await rankTextsByEmbedding(docs, query, cfg.embedBaseUrl, cfg.embedModel);
    if (ranked) return ranked.map((i) => candidates[i].index);
  }
  return bm25RankIndices(docs, query).map((i) => candidates[i].index);
}

/**
 * Pick thread indices within char budget: pin recent turns, rank older messages by query.
 */
export async function selectHistoryIndices(
  candidates: HistoryCandidate[],
  maxChars: number,
  query: string,
): Promise<number[]> {
  if (!candidates.length || maxChars <= 0) return [];
  const totalChars = candidates.reduce((sum, c) => sum + c.chars, 0);
  if (totalChars <= maxChars) {
    return candidates.map((c) => c.index);
  }

  const cfg = getHistoryContextConfig();
  const pinCount = Math.min(candidates.length, cfg.minRecentTurns * 2);
  const pinned = candidates.slice(-pinCount);
  const pinnedSet = new Set(pinned.map((c) => c.index));
  const older = candidates.filter((c) => !pinnedSet.has(c.index));

  let used = pinned.reduce((sum, c) => sum + c.chars, 0);
  const selected = new Set<number>();

  if (used > maxChars) {
    let budget = 0;
    const kept: number[] = [];
    for (let i = pinned.length - 1; i >= 0; i--) {
      if (budget + pinned[i].chars > maxChars) break;
      kept.unshift(pinned[i].index);
      budget += pinned[i].chars;
    }
    return kept;
  }

  for (const c of pinned) selected.add(c.index);

  const rankedOlder = await rankCandidateIndices(older, query);
  for (const idx of rankedOlder) {
    const c = older.find((x) => x.index === idx);
    if (!c || selected.has(idx)) continue;
    if (used + c.chars > maxChars) continue;
    selected.add(idx);
    used += c.chars;
  }

  return candidates.filter((c) => selected.has(c.index)).map((c) => c.index);
}
