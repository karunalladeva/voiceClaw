import { DynamicStructuredTool } from '@langchain/core/tools';

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  dependencies?: string[];
  systemPrompt: string;
  /** When the main agent should route to this skill (used by the router LLM) */
  triggerDescription: string;
  /** Tools this skill's agent needs */
  tools: DynamicStructuredTool[];
  /** Whether this skill is enabled */
  enabled: boolean;
  /** Optional LLM model override for this skill */
  model?: string;
  /** Optional temperature override */
  temperature?: number;
}

export abstract class BaseSkill {
  abstract define(): Promise<SkillDefinition>;
}
