import { defineTool } from '../runtime/tools';
import { z } from 'zod';
import { configManager } from '../config';

function getCcxtDisabledMessage(): string {
  return 'CCXT tools are disabled. Set config.marketData.enableCcxt=true to enable crypto exchange tools.';
}

export const cryptoTickerTool = defineTool({
  name: 'crypto_ticker',
    description:
      'CCXT scaffold for crypto ticker lookup. Requires marketData.enableCcxt=true and future live exchange integration.',
    schema: z.object({
      symbol: z.string().describe('Market symbol, e.g. BTC/USDT.'),
      exchangeId: z.string().optional().default('binance').describe('CCXT exchange id.'),
    }),
  execute: async ({ symbol, exchangeId = 'binance' }) => {
    const config = configManager.getConfig();
    if (!config.marketData.enableCcxt) {
      return JSON.stringify({
        symbol,
        exchangeId,
        error: getCcxtDisabledMessage(),
      });
    }
    return JSON.stringify({
      symbol,
      exchangeId,
      error: 'CCXT scaffold is enabled but live exchange integration is not implemented yet.',
    });
  },
});

export const cryptoOhlcvTool = defineTool({
  name: 'crypto_ohlcv',
    description:
      'CCXT scaffold for crypto OHLCV candles. Requires marketData.enableCcxt=true and future live exchange integration.',
    schema: z.object({
      symbol: z.string().describe('Market symbol, e.g. BTC/USDT.'),
      exchangeId: z.string().optional().default('binance').describe('CCXT exchange id.'),
      timeframe: z.string().optional().default('1h').describe('CCXT timeframe, e.g. 1m, 5m, 1h, 1d.'),
      limit: z.number().int().min(1).max(1000).optional().default(200).describe('Maximum returned candles.'),
    }),
  execute: async ({ symbol, exchangeId = 'binance', timeframe = '1h', limit = 200 }) => {
    const config = configManager.getConfig();
    if (!config.marketData.enableCcxt) {
      return JSON.stringify({
        symbol,
        exchangeId,
        timeframe,
        limit,
        candles: [],
        error: getCcxtDisabledMessage(),
      });
    }
    return JSON.stringify({
      symbol,
      exchangeId,
      timeframe,
      limit,
      candles: [],
      error: 'CCXT scaffold is enabled but live OHLCV integration is not implemented yet.',
    });
  },
});
