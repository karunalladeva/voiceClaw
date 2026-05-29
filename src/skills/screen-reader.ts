import { BaseSkill, SkillDefinition } from './base-skill';
import { windowsReadScreenTool } from '../tools/windows';

export default class ScreenReaderSkill extends BaseSkill {
  async define(): Promise<SkillDefinition> {
    return {
      id: 'screen-reader',
      name: 'Screen Reader',
      description: 'Reads and interprets the content of your computer screen using Vision AI.',
      triggerDescription: 'Use when the user asks "What is on my screen?", "What am I looking at?", or asks for details about a visible window, image, or text on their display.',
      systemPrompt: 
        'You are a Visual Assistant. You use the screen_read tool to "see" the user\'s desktop. \n' +
        'When asked about the screen, always take a fresh look using the tool. \n' +
        'Describe things naturally as if you are looking over the user\'s shoulder. \n' +
        'Keep your descriptions concise and relevant to the user\'s specific question.\n\n' +
        'ERROR RECOVERY: If a tool returns `Action_Failed: UI Static`, it means a click failed. Do NOT apologize. Re-scan the screen or use `windows_semantic_search` to find the correct coordinates.\n' +
        'THE JANITOR PROTOCOL: If you see an unexpected pop-up, ad, or obstructing window, call `windows_close_obstruction` to close it before proceeding.',
      tools: [windowsReadScreenTool],
      enabled: true,
    };
  }
}
