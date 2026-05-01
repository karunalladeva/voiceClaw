import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CHROMA_SERVER_PATH = 'src/mcp-servers/chromadb/index.ts';
const FINANCE_COLLECTION = 'finance_market_memory';

let chromaMcpClientPromise: Promise<Client> | null = null;

type ChromaPayload = {
  ok: boolean;
  data: unknown;
  error: string | null;
};

async function getChromaMcpClient(): Promise<Client> {
  if (!chromaMcpClientPromise) {
    chromaMcpClientPromise = (async () => {
      const transport = new StdioClientTransport({
        command: 'npx',
        args: ['ts-node', CHROMA_SERVER_PATH],
        env: { ...process.env } as Record<string, string>,
      });
      const client = new Client(
        { name: 'voiceclaw-finance-memory-client', version: '1.0.0' },
        { capabilities: {} },
      );
      await client.connect(transport);
      return client;
    })();
  }
  return chromaMcpClientPromise;
}

async function callChromaTool(name: string, args: Record<string, unknown>, timeoutMs: number = 6000): Promise<ChromaPayload> {
  try {
    const client = await getChromaMcpClient();
    const result = await Promise.race([
      client.callTool({ name, arguments: args }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Chroma MCP timeout after ${timeoutMs}ms.`)), timeoutMs)),
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
    return { ok: false, data: null, error: `Chroma MCP unavailable: ${err.message}` };
  }
}

export const financeStoreMarketMemoryTool = tool(
  async ({
    symbol,
    interval = '1h',
    sentimentScore,
    signal,
    summary,
    keyLevels,
    regime,
  }) => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const nowIso = new Date().toISOString();
    const analyzedAtEpoch = Date.now();
    const id = `${normalizedSymbol}-${analyzedAtEpoch}`;
    const doc = [
      `Symbol: ${normalizedSymbol}`,
      `Interval: ${interval}`,
      `Regime: ${regime || 'unknown'}`,
      `Signal: ${signal || 'unknown'}`,
      `SentimentScore: ${typeof sentimentScore === 'number' ? sentimentScore : 'na'}`,
      `KeyLevels: ${keyLevels || 'na'}`,
      `Summary: ${summary}`,
      `AnalyzedAt: ${nowIso}`,
    ].join('\n');

    const payload = await callChromaTool('chroma_upsert', {
      collection: FINANCE_COLLECTION,
      ids: [id],
      documents: [doc],
      metadatas: [
        {
          symbol: normalizedSymbol,
          interval,
          regime: regime || null,
          signal: signal || null,
          sentimentScore: typeof sentimentScore === 'number' ? sentimentScore : null,
          analyzedAt: nowIso,
          analyzedAtEpoch,
        },
      ],
    });

    if (!payload.ok) {
      return JSON.stringify({
        stored: false,
        reason: 'Chroma MCP not active or store failed.',
        error: payload.error,
      });
    }

    return JSON.stringify({
      stored: true,
      collection: FINANCE_COLLECTION,
      id,
      symbol: normalizedSymbol,
      analyzedAt: nowIso,
    });
  },
  {
    name: 'finance_store_market_memory',
    description:
      'Store a finance market-analysis snapshot into ChromaDB memory. Use only when Chroma MCP is active; otherwise this tool returns a skipped status.',
    schema: z.object({
      symbol: z.string().describe('Ticker symbol, e.g. AAPL, TSLA, ^GSPC.'),
      interval: z.string().optional().default('1h').describe('Analysis interval, e.g. 15m, 1h, 1d.'),
      sentimentScore: z.number().optional().describe('News sentiment score between -1 and +1 if available.'),
      signal: z.string().optional().describe('Generated trading signal/action.'),
      regime: z.string().optional().describe('Market regime, e.g. Trending or Range-bound.'),
      keyLevels: z.string().optional().describe('Support/Resistance summary string.'),
      summary: z.string().describe('Concise analysis summary to persist.'),
    }),
  },
);

export const financeRecallMarketMemoryTool = tool(
  async ({ symbol, interval, query, maxAgeDays = 30, topK = 5 }) => {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const payload = await callChromaTool('chroma_query', {
      collection: FINANCE_COLLECTION,
      queryTexts: [query || `Past analysis context for ${normalizedSymbol}`],
      nResults: topK,
      where: interval
        ? { symbol: normalizedSymbol, interval }
        : { symbol: normalizedSymbol },
    });

    if (!payload.ok) {
      return JSON.stringify({
        available: false,
        relevantItems: [],
        reason: 'Chroma MCP not active or recall failed.',
        error: payload.error,
      });
    }

    const data = payload.data as {
      ids?: string[][];
      documents?: string[][];
      metadatas?: Array<Array<Record<string, unknown>>>;
      distances?: number[][];
    };
    const documents = data.documents?.[0] || [];
    const metadatas = data.metadatas?.[0] || [];
    const distances = data.distances?.[0] || [];
    const cutoffEpoch = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

    const relevantItems = documents
      .map((doc, idx) => {
        const meta = metadatas[idx] || {};
        const analyzedAtEpoch = Number(meta.analyzedAtEpoch || 0);
        return {
          document: doc,
          metadata: meta,
          distance: typeof distances[idx] === 'number' ? distances[idx] : null,
          isFreshEnough: analyzedAtEpoch > 0 ? analyzedAtEpoch >= cutoffEpoch : true,
        };
      })
      .filter((item) => item.isFreshEnough);

    return JSON.stringify({
      available: true,
      symbol: normalizedSymbol,
      relevantItems,
      note: relevantItems.length === 0 ? 'No relevant past market memory found.' : undefined,
    });
  },
  {
    name: 'finance_recall_market_memory',
    description:
      'Recall relevant past market-analysis memory for a symbol from ChromaDB. Filters by symbol (and optional interval), and keeps only recent records by maxAgeDays.',
    schema: z.object({
      symbol: z.string().describe('Ticker symbol, e.g. AAPL, TSLA, ^GSPC.'),
      interval: z.string().optional().describe('Optional interval filter, e.g. 1h or 1d.'),
      query: z.string().optional().describe('Optional retrieval query to focus memory relevance.'),
      maxAgeDays: z.number().int().min(1).max(365).optional().default(30).describe('Maximum age in days for recalled memory.'),
      topK: z.number().int().min(1).max(20).optional().default(5).describe('Maximum number of candidates to retrieve before filtering.'),
    }),
  },
);

