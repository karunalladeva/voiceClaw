/** In-code Okapi BM25 ranking for chunk selection (no external model). */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
  'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this',
  'that', 'these', 'those', 'it', 'its', 'as', 'if', 'then', 'than', 'when', 'what', 'which',
  'who', 'how', 'why', 'where',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

const K1 = 1.5;
const B = 0.75;

/**
 * Score documents against a query; returns indices sorted by relevance (highest first).
 */
export function bm25RankIndices(documents: string[], query: string): number[] {
  if (!documents.length) return [];
  const qTokens = tokenize(query);
  if (!qTokens.length) {
    return documents.map((_, i) => i);
  }

  const docTokens = documents.map((d) => tokenize(d));
  const avgLen =
    docTokens.reduce((sum, t) => sum + t.length, 0) / Math.max(docTokens.length, 1);
  const N = documents.length;
  const df = new Map<string, number>();

  for (const tokens of docTokens) {
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        df.set(t, (df.get(t) ?? 0) + 1);
      }
    }
  }

  const scores = docTokens.map((tokens, docIdx) => {
    const tf = termFreq(tokens);
    const len = tokens.length;
    let score = 0;
    for (const term of qTokens) {
      const freq = tf.get(term) ?? 0;
      if (freq === 0) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const denom = freq + K1 * (1 - B + (B * len) / Math.max(avgLen, 1));
      score += idf * ((freq * (K1 + 1)) / Math.max(denom, 1e-9));
    }
    return { docIdx, score };
  });

  return scores
    .sort((a, b) => b.score - a.score)
    .map((s) => s.docIdx);
}
