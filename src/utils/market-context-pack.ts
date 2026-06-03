/**
 * Pack pipeline research context by whole symbol sections (BM25), not head truncation.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { bm25RankIndices } from './bm25';
import { extractStockSymbols } from './stock-tickers';
import { truncateToolOutput } from './tool-output-truncate';

const SECTION_HEADER_RE = /^## Market data for ([A-Z0-9.^$-]+)/im;
/** Target chars per symbol after pack-time URL strip (headlines + OHLCV JSON). */
const MIN_CHARS_PER_REQUESTED_SYMBOL = 2200;
const MAX_PIPELINE_CONTEXT_CHARS = 28_000;

export type MarketContextSection = { symbol: string; text: string };

export type PackPipelineMarketResult = {
  packed: string;
  sectionCount: number;
  droppedSections: number;
  symbolsRequested: string[];
  symbolsIncluded: string[];
  symbolsMissingFromResearch: string[];
};

/** Pack-time only: shrink JSON without dropping headlines or candles. */
export function stripNewsUrlsFromSection(text: string): string {
  return text
    .replace(/"url"\s*:\s*"[^"]*"/g, '"url":""')
    .replace(/,\s*"url"\s*:\s*""/g, '');
}

export function splitMarketDataSections(context: string): {
  preamble: string;
  sections: MarketContextSection[];
} {
  const trimmed = context.trim();
  if (!trimmed.includes('## Market data for ')) {
    return { preamble: trimmed, sections: [] };
  }

  const parts = trimmed.split(/\n---\n\n|\n(?=## Market data for )/);
  const preamble: string[] = [];
  const sections: MarketContextSection[] = [];

  for (const part of parts) {
    const block = part.trim();
    if (!block) continue;
    const header = block.match(SECTION_HEADER_RE);
    if (header) {
      sections.push({
        symbol: header[1].toUpperCase(),
        text: block,
      });
    } else if (sections.length === 0) {
      preamble.push(block);
    } else {
      sections[sections.length - 1].text += `\n\n${block}`;
    }
  }

  return {
    preamble: preamble.join('\n\n').trim(),
    sections,
  };
}

export function resolvePipelineContextBudget(prompt: string, configuredMax: number): number {
  const requested = extractStockSymbols(prompt);
  if (requested.length <= 1) return configuredMax;
  const scaled = requested.length * MIN_CHARS_PER_REQUESTED_SYMBOL;
  return Math.min(MAX_PIPELINE_CONTEXT_CHARS, Math.max(configuredMax, scaled));
}

function shrinkSectionForBudget(text: string, maxSectionChars: number): string {
  const stripped = stripNewsUrlsFromSection(text);
  if (stripped.length <= maxSectionChars) return stripped;
  return truncateToolOutput(stripped, maxSectionChars);
}

function orderSectionsForQuery(
  sections: MarketContextSection[],
  prompt: string,
): MarketContextSection[] {
  const requested = extractStockSymbols(prompt);
  const bySymbol = new Map(sections.map((s) => [s.symbol, s]));
  const ordered: MarketContextSection[] = [];
  const used = new Set<string>();

  for (const sym of requested) {
    const sec = bySymbol.get(sym);
    if (sec) {
      ordered.push(sec);
      used.add(sym);
    }
  }

  const rest = sections.filter((s) => !used.has(s.symbol));
  if (rest.length === 0) return ordered;

  const query = requested.length > 0 ? requested.join(' ') : prompt;
  const texts = rest.map((s) => s.text);
  let ranked: number[];
  try {
    ranked = bm25RankIndices(texts, query);
  } catch {
    ranked = rest.map((_, i) => i);
  }
  for (const idx of ranked) {
    ordered.push(rest[idx]);
  }
  return ordered;
}

function joinSections(parts: string[]): string {
  return parts.filter(Boolean).join('\n\n---\n\n');
}

/**
 * Pack research context into a char budget, keeping whole per-symbol blocks.
 * Requested tickers are never dropped entirely — sections are URL-stripped and fairly truncated.
 */
export function packPipelineMarketContext(
  context: string,
  prompt: string,
  maxChars: number,
): PackPipelineMarketResult {
  const symbolsRequested = extractStockSymbols(prompt);
  const budget = resolvePipelineContextBudget(prompt, maxChars);
  const { preamble, sections } = splitMarketDataSections(context);

  const symbolsInResearch = sections.map((s) => s.symbol);
  const symbolsMissingFromResearch = symbolsRequested.filter(
    (s) => !symbolsInResearch.includes(s),
  );

  if (sections.length === 0) {
    const packed =
      context.length <= budget ? context : truncateToolOutput(context, budget);
    return {
      packed,
      sectionCount: 0,
      droppedSections: 0,
      symbolsRequested,
      symbolsIncluded: [],
      symbolsMissingFromResearch,
    };
  }

  const ordered = orderSectionsForQuery(sections, prompt);
  const requestedSet = new Set(symbolsRequested);
  const requestedSections =
    requestedSet.size > 0
      ? ordered.filter((s) => requestedSet.has(s.symbol))
      : ordered;
  const otherSections =
    requestedSet.size > 0
      ? ordered.filter((s) => !requestedSet.has(s.symbol))
      : [];

  const selected: string[] = [];
  const symbolsIncluded: string[] = [];

  if (preamble) {
    if (preamble.length > budget) {
      return {
        packed: truncateToolOutput(preamble, budget),
        sectionCount: 0,
        droppedSections: ordered.length,
        symbolsRequested,
        symbolsIncluded: [],
        symbolsMissingFromResearch,
      };
    }
    selected.push(preamble);
  }

  let used = joinSections(selected).length;
  const sepLen = 7; // \n\n---\n\n

  if (requestedSections.length > 0) {
    const bodyBudget = Math.max(800, budget - used);
    const perSym = Math.floor(bodyBudget / requestedSections.length);
    for (const sec of requestedSections) {
      const piece = shrinkSectionForBudget(sec.text, Math.max(500, perSym));
      selected.push(piece);
      symbolsIncluded.push(sec.symbol);
    }
    used = joinSections(selected).length;
  }

  for (const sec of otherSections) {
    const piece = shrinkSectionForBudget(sec.text, budget);
    const addLen = (selected.length > 0 ? sepLen : 0) + piece.length;
    if (used + addLen > budget && selected.length > 0) break;
    selected.push(piece);
    if (!symbolsIncluded.includes(sec.symbol)) symbolsIncluded.push(sec.symbol);
    used += addLen;
  }

  if (requestedSections.length === 0) {
    for (const sec of ordered) {
      const piece = shrinkSectionForBudget(sec.text, budget);
      const addLen = (selected.length > 0 ? sepLen : 0) + piece.length;
      if (used + addLen > budget && selected.length > (preamble ? 1 : 0)) break;
      selected.push(piece);
      symbolsIncluded.push(sec.symbol);
      used += addLen;
    }
  }

  const packed = joinSections(selected);
  const includedSet = new Set(symbolsIncluded);
  const droppedFromResearch = symbolsInResearch.filter((s) => !includedSet.has(s));

  return {
    packed,
    sectionCount: symbolsIncluded.length,
    droppedSections: droppedFromResearch.length,
    symbolsRequested,
    symbolsIncluded,
    symbolsMissingFromResearch,
  };
}

/** Count ## Market data for sections in a human message (ignores prompt preamble). */
export function countMarketSymbolsInHumanInput(input: string): number {
  const marketStart = input.search(/\n## Market data for /);
  const ctx = marketStart >= 0 ? input.slice(marketStart + 1) : input;
  return splitMarketDataSections(ctx).sections.length;
}

/** Persist full research context when summarize packing drops symbol sections. */
export async function saveFullPipelineResearchContext(
  config: Record<string, unknown>,
  context: string,
): Promise<string | null> {
  const pipelineId = String(config.__pipelineId || '').trim();
  const runId = String(config.__pipelineRunId || '').trim();
  if (!pipelineId || !runId || !context.trim()) return null;

  const dir = path.join(process.cwd(), 'workspace', 'pipeline-runs', pipelineId, runId);
  const filePath = path.join(dir, 'research-context-full.txt');
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, context, 'utf-8');
    return filePath;
  } catch {
    return null;
  }
}
