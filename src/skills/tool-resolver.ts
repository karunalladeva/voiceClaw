import { DynamicStructuredTool } from '@langchain/core/tools';
import { webSearchTool, webFetchTool } from '../tools/search';
import { yahooNewsTool, yahooOhlcvTool } from '../tools/market-data';
import { financeRecallMarketMemoryTool, financeStoreMarketMemoryTool } from '../tools/finance-memory';

const toolRegistry: Record<string, DynamicStructuredTool> = {
  web_search: webSearchTool,
  web_fetch: webFetchTool,
  yahoo_news: yahooNewsTool,
  yahoo_ohlcv: yahooOhlcvTool,
  finance_recall_market_memory: financeRecallMarketMemoryTool,
  finance_store_market_memory: financeStoreMarketMemoryTool,
};

export function resolveToolsByIds(ids: string[] = []): DynamicStructuredTool[] {
  const unique = Array.from(new Set(ids));
  return unique.map((id: string) => toolRegistry[id]).filter(Boolean);
}

