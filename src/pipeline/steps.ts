/**
 * Pipeline step executors.
 * Each step receives config + context (previous step output) and returns a StepResult.
 * Steps are registered into the pipeline engine at boot time.
 */

import { registerStep, StepResult } from './pipeline-engine';
import { deliverToChannel } from './channels';
import { historyManager } from '../agents/agent-history';

interface SearchSnippet {
  title: string;
  url: string;
  description: string;
}

function buildPipelineScopedChatId(config: Record<string, any>, suffix: string): string {
  if (config.chat_id) return config.chat_id;
  const pipelineId = String(config.__pipelineId || 'pipeline');
  const runId = String(config.__pipelineRunId || 'run');
  return `pipeline:${pipelineId}:run:${runId}:${suffix}`;
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

  try {
    const snippets: SearchSnippet[] = [];

    // Primary provider: googlethis
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

    // Fallback provider: DuckDuckGo HTML results, only when Google yields no usable rows.
    if (snippets.length === 0) {
      try {
        const ddgSnippets = await searchDuckDuckGoFallback(query, maxResults);
        snippets.push(...ddgSnippets);
      } catch (fallbackError: any) {
        return {
          success: false,
          output: `Research failed (fallback error): ${fallbackError.message}`,
        };
      }
    }

    if (snippets.length === 0) {
      return { success: false, output: `No research results found for query: "${query}"` };
    }

    return { success: true, output: formatSearchSnippets(snippets), data: snippets };
  } catch (e: any) {
    return { success: false, output: `Research failed: ${e.message}` };
  }
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
  if (!context) {
    return {
      success: true,
      output: 'Skipped summarize step (no input from previous step).',
      data: { skipped: true },
    };
  }

  const prompt = config.prompt || 'Summarize the following content concisely:';
  try {
    const { ReactAgent } = await import('../agents/react-agent');
    const agent = new ReactAgent();
    await agent.initialize([]);
    const chatId = buildPipelineScopedChatId(config, 'summarize');

    let result = '';
    for await (const event of agent.processStream(
      `${prompt}\n\n${context.substring(0, 8000)}`,
      chatId,
      new AbortController().signal
    )) {
      if (event.type === 'text_done') result = event.data;
    }
    return { success: true, output: result || context.substring(0, 500) };
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
  const message = config.message || context || 'No content to deliver.';
  
  // For push channel, we allow passing a 'title'
  const settings = { ...config.settings };
  if (config.title && !settings.title) settings.title = config.title;

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
  const chatId = config.chat_id || buildPipelineScopedChatId(config, 'output');
  const tag = config.tag || 'pipeline';
  const { SystemMessage } = await import('@langchain/core/messages');
  const thread = historyManager.getThread(chatId);
  thread.push(new SystemMessage({ content: `[${tag}] ${context || 'Empty pipeline output.'}` }));
  historyManager.setThread(chatId, thread);
  await historyManager.saveChat(chatId);
  return { success: true, output: `✅ Saved to history (${chatId}).` };
});
