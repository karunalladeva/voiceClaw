import { defineTool, type ToolDefinition } from '../runtime/tools';
import type { StructuredOutputConfig } from './structured-output-types';

export type SkillToolLimits = {
  maxWebSearch?: number;
  maxWebFetch?: number;
};

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
  tools: ToolDefinition[];
  /** Whether this skill is enabled */
  enabled: boolean;
  /** Optional LLM model override for this skill */
  model?: string;
  /** Optional temperature override */
  temperature?: number;
  /** Optional fenced JSON contract (from skill-manifest.json only). */
  structuredOutput?: StructuredOutputConfig;
  /** Optional per-skill web tool caps (from skill-manifest.json only). */
  toolLimits?: SkillToolLimits;
}

export abstract class BaseSkill {
  abstract define(): Promise<SkillDefinition>;
}
