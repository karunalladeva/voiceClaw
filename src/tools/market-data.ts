import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { configManager } from '../config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

type MarketPayload = {
  ok: boolean;
  data: unknown;
  error: string | null;
};

let marketMcpClientPromise: Promise<Client> | null = null;

async function getMarketMcpClient(): Promise<Client> {
  if (!marketMcpClientPromise) {
    marketMcpClientPromise = (async () => {
      const cfg = configManager.getConfig().marketData;
      const transport = new StdioClientTransport({
        command: cfg.mcpCommand,
        args: cfg.mcpArgs.length > 0
          ? cfg.mcpArgs
          : ['ts-node', cfg.mcpServerScriptPath],
        env: {
          ...process.env,
          MARKET_ENABLE_CCXT: cfg.enableCcxt ? 'true' : 'false',
        } as Record<string, string>,
      });
      const client = new Client(
        { name: 'voiceclaw-market-mcp-tool-client', version: '1.0.0' },
        { capabilities: {} },
      );
      await client.connect(transport);
      return client;
    })();
  }
  return marketMcpClientPromise;
}

async function callMarketTool(name: string, args: Record<string, unknown>): Promise<MarketPayload> {
  const timeoutMs = configManager.getConfig().marketData.requestTimeoutMs;
  try {
    const client = await getMarketMcpClient();
    const result = await Promise.race([
      client.callTool({ name, arguments: args }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Market MCP timeout after ${timeoutMs}ms.`)), timeoutMs),
      ),
    ]) as any;

    if (result?.isError) {
      const text = (result.content || []).map((c: any) => c.text || '').join('\n').trim();
      return { ok: false, data: null, error: text || `${name} failed.` };
    }
    const text = (result.content || []).map((c: any) => c.text || '').join('\n').trim();
    try {
      return { ok: true, data: JSON.parse(text), error: null };
    } catch {
      return { ok: true, data: { raw: text }, error: null };
    }
  } catch (err: any) {
    return { ok: false, data: null, error: `Market MCP call failed: ${err.message}` };
  }
}

export const yahooOhlcvTool = tool(
  async ({
    symbol,
    interval = '1h',
    period = '5d',
    start,
    end,
    limit = 120,
  }) => {
    const payload = await callMarketTool('yahoo_ohlcv', {
      symbol,
      interval,
      period,
      limit,
    });
    if (!payload.ok) {
      return JSON.stringify({
        symbol,
        interval,
        period,
        start,
        end,
        candles: [],
        error: payload.error,
      });
    }
    return JSON.stringify(payload.data);
  },
  {
    name: 'yahoo_ohlcv',
    description:
      'Fetch OHLCV candles from Yahoo Finance through the local MCP market server. Use for stocks, ETFs, indices, and funds before technical analysis.',
    schema: z.object({
      symbol: z.string().describe('Ticker symbol, e.g. AAPL, TSLA, ^GSPC, SPY.'),
      interval: z
        .enum(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo'])
        .optional()
        .default('1h')
        .describe('Candle interval.'),
      period: z
        .string()
        .optional()
        .default('5d')
        .describe('Lookback period when start/end is not supplied, e.g. 1d, 5d, 1mo, 6mo, 1y.'),
      start: z.string().optional().describe('Optional ISO date/time start.'),
      end: z.string().optional().describe('Optional ISO date/time end.'),
      limit: z.number().int().min(1).max(1000).optional().default(120).describe('Maximum returned candles.'),
    }),
  },
);

export const yahooNewsTool = tool(
  async ({ symbol, limit = 10 }) => {
    const payload = await callMarketTool('yahoo_news', {
      symbol,
      limit,
    });
    if (!payload.ok) {
      return JSON.stringify({
        symbol,
        items: [],
        error: payload.error,
      });
    }
    const data = payload.data as { symbol?: string; items?: Array<Record<string, unknown>> };
    const items = data?.items ?? [];
    if (items.length === 0) {
      return JSON.stringify({
        symbol,
        items: [],
        note: 'No recent news found.',
      });
    }
    return JSON.stringify({
      symbol: data?.symbol || symbol,
      items,
    });
  },
  {
    name: 'yahoo_news',
    description:
      'Fetch latest Yahoo Finance news headlines for a symbol through the local MCP market server. Returns "No recent news found." when no news is available.',
    schema: z.object({
      symbol: z.string().describe('Ticker symbol, e.g. AAPL, TSLA, ^GSPC, BTC-USD.'),
      limit: z.number().int().min(1).max(50).optional().default(10).describe('Maximum number of headlines to return.'),
    }),
  },
);
