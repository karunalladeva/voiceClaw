import type { Message } from '../runtime/messages';
import { messageContentToString } from '../runtime/messages';
import { isLlmIoDebugEnabled } from './debug-logger';
import { packMarkdownToCharBudget } from './query-aware-truncate';
import {
  countMarketSymbolsInHumanInput,
  packPipelineMarketContext,
  resolvePipelineContextBudget,
} from './market-context-pack';
import { extractStockSymbols } from './stock-tickers';
import { inputHasEmbeddedMarketData } from '../agents/prompt-context';

export function messageContentLength(msg: { content?: unknown }): number {
  const c = msg.content;
  if (typeof c === 'string') return c.length;
  if (c == null) return 0;
  if (Array.isArray(c)) {
    return c.map((b: { text?: string }) => b?.text ?? '').join('').length;
  }
  return String(c).length;
}

export function sumMessagesChars(messages: Array<{ content?: unknown }>): number {
  return messages.reduce((sum, m) => sum + messageContentLength(m), 0);
}

/**
 * Cap string user input for inference; preserves whole market symbol sections when present.
 */
export function capUserInputForInference(
  input: string,
  maxChars: number,
  queryHint?: string,
): string {
  if (input.length <= maxChars) return input;

  const marketStart = input.search(/\n## Market data for /);
  if (marketStart >= 0 && inputHasEmbeddedMarketData(input)) {
    const promptPart = input.slice(0, marketStart).trim();
    const contextPart = input.slice(marketStart + 1).trim();
    const contextBudget = Math.max(
      2000,
      maxChars - promptPart.length - 2,
    );
    const configured = resolvePipelineContextBudget(
      promptPart || queryHint || '',
      contextBudget,
    );
    const { packed } = packPipelineMarketContext(
      contextPart,
      promptPart || queryHint || '',
      Math.min(configured, contextBudget),
    );
    const combined = promptPart ? `${promptPart}\n\n${packed}` : packed;
    if (combined.length <= maxChars) return combined;
    const { packed: repacked } = packPipelineMarketContext(
      contextPart,
      promptPart || queryHint || '',
      Math.max(2000, maxChars - promptPart.length - 2),
    );
    return promptPart ? `${promptPart}\n\n${repacked}` : repacked;
  }

  return packMarkdownToCharBudget(input, queryHint, maxChars);
}

export function logPromptSizes(params: {
  systemChars: number;
  humanChars: number;
  historyChars: number;
  symbolsInHuman?: number;
  symbolsRequested?: number;
}): void {
  const total = params.systemChars + params.humanChars + params.historyChars;
  let extra = '';
  if (params.symbolsInHuman != null) {
    extra += ` symbols_in_human=${params.symbolsInHuman}`;
  }
  if (params.symbolsRequested != null && params.symbolsRequested > 0) {
    extra += ` symbols_requested=${params.symbolsRequested}`;
  }
  console.log(
    `[ReAct Agent] Prompt size: system=${params.systemChars} human=${params.humanChars} history=${params.historyChars} total=${total}${extra}`,
  );
}

export function marketSymbolStatsFromHumanInput(input: string): {
  inHuman: number;
  requested: number;
} {
  const marketStart = input.search(/\n## Market data for /);
  const promptPart = marketStart >= 0 ? input.slice(0, marketStart).trim() : input;
  return {
    inHuman: countMarketSymbolsInHumanInput(input),
    requested: extractStockSymbols(promptPart).length,
  };
}

export function debugPromptDumpEnabled(): boolean {
  return isLlmIoDebugEnabled();
}

export function debugLogPromptMessages(label: string, messages: Message[]): void {
  if (!debugPromptDumpEnabled()) return;
  console.log(`[ReAct Agent] ${label}:`, { messages });
}
