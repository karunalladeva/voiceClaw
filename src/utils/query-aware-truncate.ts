import { configManager } from '../config/index';
import { bm25RankIndices, tokenize } from './bm25';
import { rankTextsByEmbedding } from './embedding-rank';
import { truncateToolOutput } from './tool-output-truncate';

export type ChunkPackResult = {
  text: string;
  partIndex: number;
  totalParts: number;
  chunksUsed: number;
  totalChunks: number;
  rankingMode: string;
  queryUsed: string;
  bridgeOverlapChars: number;
};

export function splitMarkdownChunks(markdown: string, minChars: number, overlapChars: number): string[] {
  const trimmed = markdown.trim();
  if (!trimmed) return [];

  const sections = trimmed.split(/(?=^#{1,4}\s)/m).filter((s) => s.trim().length > 0);
  const rawParts: string[] = [];
  for (const section of sections) {
    if (section.length <= minChars * 3) {
      rawParts.push(section.trim());
      continue;
    }
    const paras = section.split(/\n\n+/).filter((p) => p.trim().length > 0);
    let buf = '';
    for (const p of paras) {
      if (buf.length + p.length + 2 > minChars * 4 && buf.length >= minChars) {
        rawParts.push(buf.trim());
        buf = p;
      } else {
        buf = buf ? `${buf}\n\n${p}` : p;
      }
    }
    if (buf.trim()) rawParts.push(buf.trim());
  }

  if (rawParts.length === 0) {
    const paras = trimmed.split(/\n\n+/).filter((p) => p.trim().length > 0);
    rawParts.push(...paras);
  }

  if (overlapChars <= 0 || rawParts.length <= 1) {
    return rawParts.filter((c) => c.length >= Math.min(minChars, 80));
  }

  const withOverlap: string[] = [rawParts[0]];
  for (let i = 1; i < rawParts.length; i++) {
    const prev = rawParts[i - 1];
    const suffix = prev.slice(-overlapChars);
    withOverlap.push(`${suffix}\n\n${rawParts[i]}`.trim());
  }
  return withOverlap.filter((c) => c.length >= Math.min(minChars, 80));
}

function dedupeJoin(chunks: string[]): string {
  const out: string[] = [];
  let prevTail = '';
  for (const chunk of chunks) {
    const c = chunk.trim();
    if (!c) continue;
    if (prevTail && c.startsWith(prevTail.slice(-Math.min(120, prevTail.length)))) {
      out.push(c.slice(prevTail.length).trim() || c);
    } else {
      out.push(c);
    }
    prevTail = c.slice(-250);
  }
  return out.filter(Boolean).join('\n\n');
}

const HANDOFF_CHUNK_MIN_CHARS = 400;
const HANDOFF_CHUNK_OVERLAP_CHARS = 120;

/**
 * Shrink markdown by keeping BM25-best sections for the query (sync; no embedding).
 * Falls back to head order when query is empty, then line-boundary truncation if needed.
 */
export function packMarkdownToCharBudget(
  markdown: string,
  query: string | undefined,
  maxChars: number,
): string {
  const trimmed = markdown.trim();
  if (!trimmed || trimmed.length <= maxChars) return trimmed;

  const chunks = splitMarkdownChunks(trimmed, HANDOFF_CHUNK_MIN_CHARS, HANDOFF_CHUNK_OVERLAP_CHARS);
  if (chunks.length === 0) {
    return truncateToolOutput(trimmed, maxChars);
  }

  const q = query?.trim() ?? '';
  let ranked: number[];
  try {
    ranked = q ? bm25RankIndices(chunks, q) : chunks.map((_, i) => i);
  } catch {
    ranked = chunks.map((_, i) => i);
  }

  const selected: string[] = [];
  let len = 0;
  for (const idx of ranked) {
    const chunk = chunks[idx];
    if (!chunk) continue;
    if (len + chunk.length + 4 > maxChars && selected.length > 0) break;
    selected.push(chunk);
    len += chunk.length + 4;
  }

  if (selected.length === 0) {
    return truncateToolOutput(trimmed, maxChars);
  }

  let packed = dedupeJoin(selected);
  if (packed.length > maxChars) {
    packed = truncateToolOutput(packed, maxChars);
  }
  return packed;
}

async function rankChunkIndices(chunks: string[], query: string): Promise<{ indices: number[]; mode: string }> {
  const cfg = configManager.getConfig().webFetch;
  const q = query.trim();
  if (!q) {
    return { indices: chunks.map((_, i) => i), mode: 'head' };
  }

  if (cfg.chunkRanking === 'head') {
    return { indices: chunks.map((_, i) => i), mode: 'head' };
  }

  if (cfg.chunkRanking === 'embedding') {
    const embedded = await rankTextsByEmbedding(chunks, q, cfg.embedBaseUrl, cfg.embedModel);
    if (embedded) return { indices: embedded, mode: 'embedding' };
  }

  try {
    return { indices: bm25RankIndices(chunks, q), mode: 'bm25' };
  } catch {
    return { indices: chunks.map((_, i) => i), mode: 'head' };
  }
}

function packPartFromRanked(
  chunks: string[],
  rankedIndices: number[],
  maxChars: number,
  partIndex: number,
  overlapChars: number,
  priorPartText: string | null,
): { text: string; used: number; totalParts: number } {
  const perPart = Math.max(500, Math.floor(maxChars * 0.95));
  const startRank = partIndex * Math.max(1, Math.ceil(rankedIndices.length / Math.ceil(chunks.length / 4)));
  let bridge = '';
  if (partIndex > 0 && priorPartText && overlapChars > 0) {
    bridge = priorPartText.slice(-overlapChars);
  }

  const selected: string[] = [];
  let len = bridge.length;
  const stride = Math.max(1, Math.floor(rankedIndices.length / 5));
  for (let i = partIndex * stride; i < rankedIndices.length; i++) {
    const chunk = chunks[rankedIndices[i]];
    if (len + chunk.length + 4 > perPart && selected.length > 0) break;
    selected.push(chunk);
    len += chunk.length + 4;
  }

  if (selected.length === 0 && partIndex < rankedIndices.length) {
    selected.push(chunks[rankedIndices[partIndex]]);
  }

  const body = dedupeJoin(selected);
  let text = bridge ? `${bridge}\n\n${body}` : body;
  if (text.length > perPart) {
    text = truncateToolOutput(text, perPart);
  }

  const totalParts = Math.max(1, Math.ceil(rankedIndices.length / Math.max(selected.length, 1)));
  return { text, used: selected.length, totalParts };
}

export async function packMarkdownForQuery(
  markdown: string,
  query: string,
  partIndex: number,
  priorPartText: string | null,
): Promise<ChunkPackResult> {
  const cfg = configManager.getConfig().webFetch;
  const maxChars = cfg.maxChars;
  const minChars = cfg.chunkMinChars;
  const overlap = cfg.chunkOverlapChars;

  if (markdown.length <= maxChars) {
    return {
      text: markdown,
      partIndex: 0,
      totalParts: 1,
      chunksUsed: 1,
      totalChunks: 1,
      rankingMode: 'none',
      queryUsed: query,
      bridgeOverlapChars: 0,
    };
  }

  const chunks = splitMarkdownChunks(markdown, minChars, overlap);
  const { indices: ranked, mode } = await rankChunkIndices(chunks, query);
  const packed = packPartFromRanked(chunks, ranked, maxChars, partIndex, overlap, priorPartText);

  const footer =
    packed.totalParts > 1 && partIndex + 1 < packed.totalParts
      ? `\n\n---\n\n[part ${partIndex + 1}/${packed.totalParts} — ${packed.used}/${chunks.length} chunks for: "${query.slice(0, 80)}"; mode: ${mode}; next: web_fetch same URL with part=${partIndex + 1}]`
      : '';

  return {
    text: packed.text + footer,
    partIndex,
    totalParts: packed.totalParts,
    chunksUsed: packed.used,
    totalChunks: chunks.length,
    rankingMode: mode,
    queryUsed: query,
    bridgeOverlapChars: partIndex > 0 && priorPartText ? Math.min(overlap, priorPartText.length) : 0,
  };
}

/** Weak query from title when nothing else available. */
export function queryFromTitle(title: string): string {
  const tokens = tokenize(title);
  return tokens.slice(0, 12).join(' ');
}
