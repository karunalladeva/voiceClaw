import { BaseSkill, SkillDefinition } from './base-skill';
import { webSearchTool, webFetchTool } from '../tools/search';

export default class WebResearcherSkill extends BaseSkill {
  async define(): Promise<SkillDefinition> {
    return {
      id: 'web-researcher',
      name: 'Web Researcher',
      description: 'Searches the internet and synthesizes information from multiple sources.',
      triggerDescription: 'Use when the user asks about current events, news, facts, or anything that requires up-to-date information from the internet.',
      systemPrompt:
        'You are a web research specialist.\n\n' +
        'WORKFLOW:\n' +
        '1. web_search — one or two focused queries (up to 15 ranked results with score/date). Scan snippets; do not fetch every link.\n' +
        '2. web_fetch — pick the best 1–3 distinct URLs (official or primary sources first; prefer URLs marked recommended). ' +
        'Tool budget: 5 fetches per run — each URL, part=, or focus= counts as one call. ' +
        'For one long page use part=0 then part=1,2 instead of many URLs. Use focus= for a sub-topic on the same URL.\n' +
        '3. Synthesize a short answer from fetched markdown only.\n\n' +
        'RULES:\n' +
        '- Never state specific numbers (scores, prices, dates) from snippets alone.\n' +
        '- If web_fetch fails, try another URL from the 15 search results — do not guess.\n' +
        '- Do not paste raw tool output; write a clean summary.\n' +
        '- Keep the voice response brief and natural (may be spoken aloud).',
      tools: [webSearchTool, webFetchTool],
      toolLimits: { maxWebSearch: 4, maxWebFetch: 5 },
      enabled: true,
    };
  }
}
