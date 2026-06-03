#!/usr/bin/env node

import "../stdio-guard";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import YahooFinance from "yahoo-finance2";

const server = new Server(
  {
    name: "market-tools",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);
const yahooFinance = new YahooFinance();

const ENABLE_CCXT = process.env.MARKET_ENABLE_CCXT === "true";

function resolvePeriodStart(period: string): Date {
  const now = new Date();
  const lower = (period || "5d").toLowerCase();
  const match = lower.match(/^(\d+)([dwmy])$/);
  if (!match) {
    const fallback = new Date(now);
    fallback.setDate(fallback.getDate() - 5);
    return fallback;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const start = new Date(now);
  if (unit === "d") start.setDate(start.getDate() - amount);
  if (unit === "w") start.setDate(start.getDate() - amount * 7);
  if (unit === "m") start.setMonth(start.getMonth() - amount);
  if (unit === "y") start.setFullYear(start.getFullYear() - amount);
  return start;
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "yahoo_ohlcv",
        description: "Fetch OHLCV candles from Yahoo Finance for stocks, ETFs, indices, or funds.",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Ticker symbol, e.g. AAPL, SPY, ^GSPC" },
            interval: { type: "string", description: "Interval, e.g. 1m, 5m, 1h, 1d", default: "1h" },
            period: { type: "string", description: "Range, e.g. 1d, 5d, 1mo, 6mo, 1y", default: "5d" },
            limit: { type: "number", description: "Maximum candles to return", default: 120 },
          },
          required: ["symbol"],
        },
      },
      {
        name: "yahoo_news",
        description: "Fetch latest Yahoo Finance news for a symbol.",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Ticker symbol, e.g. AAPL, TSLA, BTC-USD" },
            limit: { type: "number", description: "Maximum headlines to return", default: 10 },
          },
          required: ["symbol"],
        },
      },
      {
        name: "crypto_ohlcv",
        description: "CCXT scaffold tool for crypto OHLCV. Returns disabled unless MARKET_ENABLE_CCXT=true.",
        inputSchema: {
          type: "object",
          properties: {
            exchangeId: { type: "string", description: "Exchange id, e.g. binance", default: "binance" },
            symbol: { type: "string", description: "Pair, e.g. BTC/USDT" },
            timeframe: { type: "string", description: "Timeframe, e.g. 1m, 5m, 1h", default: "1h" },
            limit: { type: "number", description: "Maximum candles", default: 200 },
          },
          required: ["symbol"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = (args || {}) as Record<string, any>;
  try {
    if (name === "yahoo_ohlcv") {
      const symbol = String(input.symbol || "").trim().toUpperCase();
      if (!symbol) throw new Error("symbol is required");
      const interval = String(input.interval || "1h");
      const period = String(input.period || "5d");
      const limit = Math.max(1, Math.min(1000, Number(input.limit || 120)));

      const period1 = resolvePeriodStart(period);
      const result = await yahooFinance.chart(symbol, {
        period1,
        interval: interval as any,
        return: "array",
      }) as any;
      const quotes = ((result as any)?.quotes || []).slice(-limit).map((q: any) => ({
        time: q.date ? new Date(q.date).toISOString() : null,
        open: q.open ?? null,
        high: q.high ?? null,
        low: q.low ?? null,
        close: q.close ?? null,
        volume: q.volume ?? null,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify({ symbol, interval, period, candles: quotes }) }],
      };
    }

    if (name === "yahoo_news") {
      const symbol = String(input.symbol || "").trim().toUpperCase();
      if (!symbol) throw new Error("symbol is required");
      const limit = Math.max(1, Math.min(50, Number(input.limit || 10)));
      const searchResult = await yahooFinance.search(symbol, {
        quotesCount: 0,
        newsCount: limit,
      }) as any;
      const rawNews = searchResult?.news || [];
      const items = rawNews.slice(0, limit).map((item: any) => ({
        title: item?.title || "",
        publisher: item?.publisher || "",
        published_at: item?.providerPublishTime || null,
        summary: item?.summary || "",
        url: item?.link || "",
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ symbol, items }) }],
      };
    }

    if (name === "crypto_ohlcv") {
      if (!ENABLE_CCXT) {
        return {
          content: [{ type: "text", text: JSON.stringify({ candles: [], error: "CCXT disabled. Set MARKET_ENABLE_CCXT=true." }) }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ candles: [], error: "CCXT enabled, but live integration is not implemented in this pass." }) }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("Market MCP Server running on stdio");
});
