/**
 * Pipeline step executors.
 * Each step receives config + context (previous step output) and returns a StepResult.
 * Steps are registered into the pipeline engine at boot time.
 */

import { registerStep, StepResult } from './pipeline-engine';
import { deliverToChannel } from './channels';
import { historyManager } from '../agents/agent-history';
import { configManager } from '../config';
import {
  packPipelineMarketContext,
  saveFullPipelineResearchContext,
} from '../utils/market-context-pack';
import { extractStockSymbols } from '../utils/stock-tickers';

interface SearchSnippet {
  title: string;
  url: string;
  description: string;
}

function buildPipelineScopedChatId(config: Record<string, any>, suffix: string): string {
  if (config.chat_id) return config.chat_id;
  const pipelineId = String(config.__pipelineId || 'pipeline');
  const runId = String(config.__pipelineRunId || 'run');
  // Use dashes instead of colons (colons are invalid in Windows file paths)
  return `pipeline-${pipelineId}-run-${runId}-${suffix}`;
}

function formatSearchSnippets(snippets: SearchSnippet[]): string {
  return snippets
    .map((r: SearchSnippet, i: number) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
    .join('\n\n');
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchMarketResearchFallback(query: string, symbol?: string): Promise<string | null> {
  const tickers = extractStockSymbols(query, symbol);
  if (tickers.length === 0) return null;
  try {
    const { yahooOhlcvTool, yahooNewsTool } = await import('../tools/market-data');
    const sections: string[] = [];
    for (const ticker of tickers.slice(0, 12)) {
      const [ohlcv, news] = await Promise.all([
        yahooOhlcvTool.invoke({ symbol: ticker, period: '1mo', interval: '1d', limit: 30 }),
        yahooNewsTool.invoke({ symbol: ticker, limit: 8 }),
      ]);
      sections.push(
        [
          `## Market data for ${ticker} (Yahoo Finance)`,
          '',
          '### Price / OHLCV',
          typeof ohlcv === 'string' ? ohlcv : JSON.stringify(ohlcv, null, 2),
          '',
          '### Recent news',
          typeof news === 'string' ? news : JSON.stringify(news, null, 2),
        ].join('\n'),
      );
    }
    return sections.join('\n\n---\n\n');
  } catch {
    return null;
  }
}

async function searchDuckDuckGoFallback(query: string, maxResults: number): Promise<SearchSnippet[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; pipeline-research-bot/1.0)',
    },
  });
  if (!response.ok) {
    return [];
  }
  const html = await response.text();
  const matches = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  return matches
    .slice(0, maxResults)
    .map((match: RegExpMatchArray) => {
      const rawHref = String(match[1] || '');
      const hrefMatch = rawHref.match(/[?&]uddg=([^&]+)/);
      const urlValue = hrefMatch ? decodeURIComponent(hrefMatch[1]) : rawHref;
      return {
        title: stripHtml(String(match[2] || 'Untitled result')),
        url: urlValue,
        description: 'Fetched via DuckDuckGo fallback search.',
      };
    })
    .filter((item: SearchSnippet) => item.title.length > 0 && item.url.length > 0);
}

// ── ai_task: Run a prompt through the main agent ──────────────────────────────

registerStep('ai_task', async (config, context): Promise<StepResult> => {
  const prompt = config.prompt || 'Process the following context and respond.';
  const fullPrompt = context
    ? `${prompt}\n\n--- Context from previous step ---\n${context}`
    : prompt;

  try {
    // Lazy import to avoid circular deps
    const { ReactAgent } = await import('../agents/react-agent');
    const agent = new ReactAgent();
    await agent.initialize([]);
    const chatId = buildPipelineScopedChatId(config, 'ai_task');

    let result = '';
    for await (const event of agent.processStream(fullPrompt, chatId, new AbortController().signal)) {
      if (event.type === 'text_done') result = event.data;
    }
    return { success: true, output: result || 'No response from agent.' };
  } catch (e: any) {
    return { success: false, output: `ai_task failed: ${e.message}` };
  }
});

// ── research: Web search and return results ───────────────────────────────────

registerStep('research', async (config, context): Promise<StepResult> => {
  const query = config.query || context || '';
  if (!query) return { success: false, output: 'No search query provided.' };

  const maxResults = Number(config.max_results || 5);
  const snippets: SearchSnippet[] = [];
  let googleError: string | null = null;

  // Primary provider: googlethis
  try {
    const google = require('googlethis');
    const results = await google.search(query, { page: 0, safe: false });
    const primarySnippets = (results.results || [])
      .slice(0, maxResults)
      .map((r: any) => ({
        title: String(r.title || '').trim(),
        url: String(r.url || '').trim(),
        description: String(r.description || '').trim(),
      }))
      .filter((r: SearchSnippet) => r.title && r.url);
    snippets.push(...primarySnippets);
  } catch (e: any) {
    googleError = e.message;
  }

  // Fallback provider: DuckDuckGo - used when Google fails OR returns no results
  if (snippets.length === 0) {
    try {
      const ddgSnippets = await searchDuckDuckGoFallback(query, maxResults);
      snippets.push(...ddgSnippets);
    } catch (fallbackError: any) {
      const baseError = googleError ? `Google: ${googleError}` : 'Google returned no results';
      return {
        success: false,
        output: `Research failed. ${baseError}. DuckDuckGo fallback also failed: ${fallbackError.message}`,
      };
    }
  }

  if (snippets.length === 0) {
    const marketFallback = await fetchMarketResearchFallback(query, config.symbol);
    if (marketFallback) {
      return {
        success: true,
        output: `${marketFallback}\n\n(via Yahoo Finance — web search had no results)`,
        data: { source: 'yahoo_finance' },
      };
    }
    const reason = googleError ? `Google error: ${googleError}` : 'No results from any provider';
    return { success: false, output: `No research results found for query: "${query}". ${reason}` };
  }

  // Success - fallback worked even if Google failed
  const source = googleError ? ' (via DuckDuckGo fallback)' : '';
  return { success: true, output: formatSearchSnippets(snippets) + source, data: snippets };
});

// ── browse: Playwright browser automation ─────────────────────────────────────

registerStep('browse', async (config, context): Promise<StepResult> => {
  const url = config.url || context?.trim();
  if (!url) return { success: false, output: 'No URL to browse.' };

  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: config.headless !== false });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    let output = '';
    if (config.selector) {
      const el = await page.$(config.selector);
      output = el ? await el.textContent() : `Selector "${config.selector}" not found.`;
    } else if (config.extract === 'links') {
      const links = await page.$$eval('a[href]', (els: any[]) =>
        els.slice(0, 20).map(a => ({ text: a.textContent?.trim(), href: a.href }))
      );
      output = links.map((l: any) => `- [${l.text}](${l.href})`).join('\n');
    } else {
      output = await page.textContent('body') || '';
      output = output.substring(0, config.max_chars || 3000);
    }

    if (config.screenshot) {
      await page.screenshot({ path: config.screenshot });
      output += `\n📸 Screenshot saved: ${config.screenshot}`;
    }

    await browser.close();
    return { success: true, output };
  } catch (e: any) {
    return { success: false, output: `Browse failed: ${e.message}` };
  }
});

// ── summarize: LLM summarization of context ───────────────────────────────────

registerStep('summarize', async (config, context): Promise<StepResult> => {
  const prompt = config.prompt || 'Summarize the following content concisely:';
  const hasUsableContext =
    Boolean(context) &&
    !context.startsWith('[ERROR]') &&
    !context.includes('No research results found') &&
    context.trim().length > 20;

  if (!hasUsableContext) {
    const symbol = config.symbol as string | undefined;
    const fallbackPrompt =
      (config.fallback_prompt as string | undefined) ||
      (symbol
        ? `Analyze ${symbol} stock using available market tools (OHLCV, news). Provide levels, trend, catalysts, and a concise trading summary.`
        : null);
    if (fallbackPrompt) {
      try {
        const { ReactAgent } = await import('../agents/react-agent');
        const agent = new ReactAgent();
        await agent.initialize([]);
        const chatId = buildPipelineScopedChatId(config, 'summarize-fallback');
        let result = '';
        for await (const event of agent.processStream(fallbackPrompt, chatId, new AbortController().signal)) {
          if (event.type === 'text_done') result = event.data;
        }
        if (result) {
          return { success: true, output: result, data: { usedFallback: true } };
        }
      } catch (e: any) {
        return { success: false, output: `Summarize fallback failed: ${e.message}` };
      }
    }
    return {
      success: false,
      output: 'Nothing to summarize (no input from previous step).',
    };
  }

  try {
    const maxContext = configManager.getConfig().pipeline.contextMaxChars;
    const packResult = packPipelineMarketContext(context, prompt, maxContext);
    const { packed, sectionCount, droppedSections } = packResult;
    if (
      droppedSections > 0 ||
      packResult.symbolsMissingFromResearch.length > 0 ||
      packResult.symbolsRequested.length > packResult.symbolsIncluded.length
    ) {
      const artifactPath = await saveFullPipelineResearchContext(config, context);
      console.log(
        `[Pipeline] Summarize context: requested=[${packResult.symbolsRequested.join(',')}] ` +
          `included=[${packResult.symbolsIncluded.join(',')}] ` +
          `missing_research=[${packResult.symbolsMissingFromResearch.join(',')}] ` +
          `dropped_sections=${droppedSections} packed_chars=${packed.length}` +
          (artifactPath ? ` full_context=${artifactPath}` : ''),
      );
    }

    const { ReactAgent } = await import('../agents/react-agent');
    const agent = new ReactAgent();
    await agent.initialize([]);
    const chatId = buildPipelineScopedChatId(config, 'summarize');

    let result = '';
    for await (const event of agent.processStream(
      `${prompt}\n\n${packed}`,
      chatId,
      new AbortController().signal
    )) {
      if (event.type === 'text_done') result = event.data;
    }
    return {
      success: true,
      output: result || packed.substring(0, 500),
      data: { sectionsPacked: sectionCount, sectionsDropped: droppedSections },
    };
  } catch (e: any) {
    return { success: false, output: `Summarize failed: ${e.message}` };
  }
});

// ── generate_doc: Generate a document from template + context ──────────────────

registerStep('generate_doc', async (config, context): Promise<StepResult> => {
  const templatePath = config.template_path;
  let template = '';

  if (templatePath) {
    try {
      const fs = require('fs/promises');
      template = await fs.readFile(templatePath, 'utf-8');
    } catch {
      template = '';
    }
  }

  const prompt = config.prompt || 'Generate a professional document based on the template and context:';
  const fullPrompt = template
    ? `${prompt}\n\n--- Template ---\n${template}\n\n--- Context ---\n${context || 'No context provided.'}`
    : `${prompt}\n\n--- Context ---\n${context || 'No context provided.'}`;

  try {
    const { ReactAgent } = await import('../agents/react-agent');
    const agent = new ReactAgent();
    await agent.initialize([]);
    const chatId = buildPipelineScopedChatId(config, 'generate_doc');

    let result = '';
    for await (const event of agent.processStream(fullPrompt, chatId, new AbortController().signal)) {
      if (event.type === 'text_done') result = event.data;
    }

    // Optionally save to file
    if (config.output_path && result) {
      const fs = require('fs/promises');
      await fs.writeFile(config.output_path, result, 'utf-8');
      result += `\n\n📄 Saved to: ${config.output_path}`;
    }

    return { success: true, output: result || 'No document generated.' };
  } catch (e: any) {
    return { success: false, output: `Document generation failed: ${e.message}` };
  }
});

// ── deliver: Send to a channel ────────────────────────────────────────────────

registerStep('deliver', async (config, context): Promise<StepResult> => {
  // Support both 'channel' and 'type' for robustness (some models hallucinate 'type')
  const channel = config.channel || config.type || 'history';
  
  // For history channel: prioritize pipeline context (actual output) over config.message
  // For other channels (push, email, etc.): use config.message as the notification text
  const message = channel === 'history'
    ? (context || config.message || 'No content to deliver.')
    : (config.message || context || 'No content to deliver.');

  // Build settings from config.settings + top-level config fields for HistoryProvider
  const settings: Record<string, string> = { ...config.settings };
  if (config.title && !settings.title) settings.title = config.title;
  
  // Use pipeline's own ID for chat_id (not generated from name)
  const effectiveChatId = config.chat_id || config.__pipelineId || 'execution-pipeline';
  if (!settings.chat_id) settings.chat_id = effectiveChatId;
  
  // Use pipeline name + date for chat_title
  const effectiveTitle = config.chat_title || (config.__pipelineName 
    ? `${config.__pipelineName} - ${new Date().toISOString().split('T')[0]}`
    : undefined);
  if (effectiveTitle && !settings.chat_title) settings.chat_title = effectiveTitle;

  const result = await deliverToChannel(channel, message, settings);
  return { success: result.startsWith('✅'), output: result };
});

// ── save_history: Save pipeline output to chat history ────────────────────────

// ── get_system_info: Fetch system date, time, and location ──────────────────────

registerStep('get_system_info', async (config, context): Promise<StepResult> => {
  try {
    const now = new Date();
    const dateStr = now.toLocaleDateString();
    const timeStr = now.toLocaleTimeString();
    
    let location = 'Unknown Location';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch('https://ipapi.co/json/', { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        location = `${data.city}, ${data.region}, ${data.country_name} (Lat: ${data.latitude}, Lon: ${data.longitude})`;
      }
    } catch (e) {
      // Ignore location fetch errors, fallback to Unknown
    }

    const output = `Current Date: ${dateStr}\nCurrent Time: ${timeStr}\nApproximate Location: ${location}`;
    return { success: true, output };
  } catch (e: any) {
    return { success: false, output: `get_system_info failed: ${e.message}` };
  }
});

registerStep('save_history', async (config, context): Promise<StepResult> => {
  // Use pipeline's own ID for chat_id (not generated from name)
  const chatId = config.chat_id || config.__pipelineId || 'execution-pipeline';
  
  // Use pipeline name + date for chat_title
  const chatTitle = config.chat_title || (config.__pipelineName 
    ? `${config.__pipelineName} - ${new Date().toISOString().split('T')[0]}`
    : 'Pipeline Execution');
  
  const tag = config.tag || 'pipeline';
  const { SystemMessage } = await import('@langchain/core/messages');
  const thread = historyManager.getThread(chatId);
  thread.push(new SystemMessage({ content: `[${tag}] ${context || 'Empty pipeline output.'}` }));
  historyManager.setThread(chatId, thread);
  await historyManager.saveChat(chatId, chatTitle);
  return { success: true, output: `✅ Saved to history (${chatId}).` };
});
