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
        'You are a web research specialist. When the user asks a question, ' +
        'use the web_search tool to find relevant information. Search multiple queries if needed. ' +
        'Synthesize the results into a clear, concise answer. ' +
        'Always cite your sources. Your response will be spoken aloud, so keep it brief and natural.',
      tools: [webSearchTool],
      enabled: true,
    };
  }
}
