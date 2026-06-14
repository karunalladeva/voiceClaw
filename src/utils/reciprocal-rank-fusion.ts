export type RankedUrl = { url: string; score?: number };

/**
 * Reciprocal rank fusion — merge multiple ranked URL lists without score normalization.
 */
export function reciprocalRankFusion(
  rankings: string[][],
  k = 60,
): string[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const url = ranking[rank];
      if (!url) continue;
      scores.set(url, (scores.get(url) ?? 0) + 1 / (k + rank + 1));
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url);
}

export function reciprocalRankFusionHits<T extends { url: string }>(
  rankings: T[][],
  k = 60,
): T[] {
  const byUrl = new Map<string, T>();
  for (const list of rankings) {
    for (const hit of list) {
      if (!byUrl.has(hit.url)) byUrl.set(hit.url, hit);
    }
  }
  const urls = reciprocalRankFusion(
    rankings.map((list) => list.map((h) => h.url)),
    k,
  );
  return urls.map((url) => byUrl.get(url)!).filter(Boolean);
}
