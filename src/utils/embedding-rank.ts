/** Rank text snippets by cosine similarity to a query via Ollama-compatible /api/embeddings. */

export async function rankTextsByEmbedding(
  texts: string[],
  query: string,
  baseUrl: string,
  model: string,
  maxTexts = 60,
): Promise<number[] | null> {
  const slice = texts.slice(0, maxTexts);
  if (!slice.length || !query.trim()) return null;
  try {
    const embed = async (text: string): Promise<number[] | null> => {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text.slice(0, 2000) }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { embedding?: number[] };
      return data.embedding ?? null;
    };

    const qVec = await embed(query);
    if (!qVec?.length) return null;

    const scored: { idx: number; score: number }[] = [];
    for (let i = 0; i < slice.length; i++) {
      const vec = await embed(slice[i]);
      if (!vec || vec.length !== qVec.length) continue;
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let j = 0; j < qVec.length; j++) {
        dot += qVec[j] * vec[j];
        na += qVec[j] * qVec[j];
        nb += vec[j] * vec[j];
      }
      const sim = dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
      scored.push({ idx: i, score: sim });
    }
    if (!scored.length) return null;
    return scored.sort((a, b) => b.score - a.score).map((s) => s.idx);
  } catch {
    return null;
  }
}
