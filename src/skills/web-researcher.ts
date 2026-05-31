import { BaseSkill, SkillDefinition } from './base-skill';
import { webSearchTool } from '../tools/search';

export default class WebResearcherSkill extends BaseSkill {
  async define(): Promise<SkillDefinition> {
    return {
      id: 'web-researcher',
      name: 'Web Researcher',
      description: 'Searches the internet and synthesizes information from multiple sources.',
      triggerDescription: 'Use when the user asks about current events, news, facts, or anything that requires up-to-date information from the internet.',
      systemPrompt:
        'You are a web research specialist. For current events, live scores, prices, or weather: ' +
        'you MUST call web_search, then web_fetch on the best result URL to read the full page. ' +
        'Never state specific numbers (scores, prices, temperatures) from search snippets alone. ' +
        'If web_fetch fails, say live data is unavailable — do not guess. ' +
        'Synthesize only facts present in fetched page content. ' +
        'Your response will be spoken aloud, so keep it brief and natural.',
      tools: [webSearchTool],
      enabled: true,
    };
  }
}
