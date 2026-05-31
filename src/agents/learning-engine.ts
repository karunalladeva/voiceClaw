import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { MCPClientManager } from './mcp-client';
import { modelRouter } from '../models/model-router';
import {
  isValidLongTermMemory,
  shouldSkipAutoMemoryExtraction,
} from './memory-policy';

const WORKSPACE = path.join(process.cwd(), 'workspace');
const LEARNED_SKILLS_DRAFT_DIR = path.join(WORKSPACE, 'learned-skills-draft');
const LEARNED_SKILLS_VALIDATED_DIR = path.join(WORKSPACE, 'learned-skills-validated');
const LEARNED_SKILLS_ENABLED_DIR = path.join(WORKSPACE, 'learned-skills');
const MACROS_DIR = path.join(WORKSPACE, 'learned', 'macros');

export interface Macro {
  name: string;
  trigger: string;
  steps: Array<{ tool: string; args: any }>;
}

// Known failure phrases that indicate the agent cannot complete the task
const FAILURE_PHRASES = [
  "i don't know",
  "i cannot",
  "i can't",
  "i am unable",
  "i'm unable",
  "i do not know",
  "i'm not able",
  "i am not able",
  "beyond my capabilities",
  "i have no way",
  "not within my",
  "i lack the",
];

const TRANSIENT_ERROR_PHRASES = [
  'timed out',
  'timeout',
  'connection refused',
  'fetch failed',
  'temporarily unavailable',
  'service unavailable',
  'rate limit',
];

const TOOL_ERROR_PHRASES = [
  'tool execution failed',
  'tool failed',
  'error:',
  'failed to load',
];

const TIME_SENSITIVE_MEMORY_PHRASES = [
  'today',
  'current',
  'latest',
  'price',
  'rate',
  'weather',
  'news',
  'score',
  'market',
];

export type FailureType =
  | 'none'
  | 'capability_gap'
  | 'tool_error'
  | 'transient_infra'
  | 'context_overflow'
  | 'unknown_failure';

export interface FailureAssessment {
  shouldRetry: boolean;
  failureType: FailureType;
  reason: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 50);
}

export class LearningEngine {
  private llm: any = null;

  private async getLlm() {
    if (!this.llm) {
      this.llm = await modelRouter.getMasterModel();
    }
    return this.llm;
  }

  // ── Should Retry? ──────────────────────────────────────────────────────────

  assessFailure(response: string): FailureAssessment {
    const lower = response.toLowerCase();
    if (!response.trim()) {
      return {
        shouldRetry: true,
        failureType: 'unknown_failure',
        reason: 'Empty model response.',
      };
    }
    if (lower.includes('recursion limit') || lower.includes('context window') || lower.includes('token limit')) {
      return {
        shouldRetry: true,
        failureType: 'context_overflow',
        reason: 'Response indicates context/token overflow.',
      };
    }
    if (TRANSIENT_ERROR_PHRASES.some(phrase => lower.includes(phrase))) {
      return {
        shouldRetry: true,
        failureType: 'transient_infra',
        reason: 'Response indicates transient infrastructure/network issue.',
      };
    }
    if (TOOL_ERROR_PHRASES.some(phrase => lower.includes(phrase))) {
      return {
        shouldRetry: true,
        failureType: 'tool_error',
        reason: 'Response indicates tool execution failure.',
      };
    }
    if (FAILURE_PHRASES.some(phrase => lower.includes(phrase))) {
      return {
        shouldRetry: true,
        failureType: 'capability_gap',
        reason: 'Model indicates inability/capability gap.',
      };
    }
    return {
      shouldRetry: false,
      failureType: 'none',
      reason: 'No retry indicators found.',
    };
  }

  /**
   * Backward-compatible wrapper used by existing callers.
   */
  shouldRetry(response: string): boolean {
    return this.assessFailure(response).shouldRetry;
  }

  private isMemoryCandidateValid(content: string, tags: string[] = []): boolean {
    if (!isValidLongTermMemory(content, tags)) return false;
    const normalized = content.trim();
    const lower = normalized.toLowerCase();
    if (TIME_SENSITIVE_MEMORY_PHRASES.some(p => lower.includes(p))) return false;
    if (lower.startsWith('http://') || lower.startsWith('https://')) return false;
    if (lower.includes('no_memory')) return false;
    return true;
  }

  async autoExtractAndStore(
    userInput: string,
    agentResponse: string,
    mcpManager: MCPClientManager,
    chatId: string = 'default',
  ): Promise<void> {
    if (shouldSkipAutoMemoryExtraction(chatId, userInput, agentResponse)) return;

    try {
      const llm = await this.getLlm();
      const extractPrompt =
        `You are a memory extraction assistant. Store ONLY durable facts about the USER (name, location, timezone, preferences, long-term goals).\n` +
        `Do NOT store: chat summaries, stock analysis, pipeline/automation setup, one-time tasks, agent actions, or transient intents.\n` +
        `If nothing qualifies, reply exactly: NO_MEMORY\n` +
        `If YES, reply with JSON only: { "content": "...", "tags": ["tag1"] }\n\n` +
        `User: ${userInput}\nAgent: ${agentResponse.substring(0, 400)}`;

      const result = await llm.invoke([
        new SystemMessage('You extract important facts from conversations for long-term memory.'),
        new HumanMessage(extractPrompt),
      ]);

      const text = result.content.toString().trim();
      if (text === 'NO_MEMORY') return;

      // Try to find JSON in the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.content) {
        const content = String(parsed.content).trim();
        const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
        const sanitizedTags: string[] = Array.from(
          new Set(
            tags
              .map((t: any) => String(t || '').trim().toLowerCase())
              .filter((t: string) => t.length > 1 && t.length < 40),
          ),
        );
        sanitizedTags.push('source:auto', `created:${new Date().toISOString().split('T')[0]}`);
        if (!this.isMemoryCandidateValid(content, sanitizedTags)) return;
        await mcpManager.addMemory(content, sanitizedTags);
        console.log('[LearningEngine] Auto-stored memory:', parsed.content.substring(0, 60));
      }
    } catch (err: any) {
      console.error('[LearningEngine] Auto-store failed (non-critical):', err.message);
    }
  }

  // ── Macro Extraction (Phase 3) ─────────────────────────────────────────────

  async extractMacroFromSuccess(userIntent: string, toolTrace: Array<{ tool: string; args: any }>): Promise<void> {
    // Only extract macros if the sequence relies exclusively on physical interaction tools.
    // If it uses web_search or python scripts, it is non-deterministic.
    const allowedMacroTools = ['windows_mouse_click', 'windows_type_text', 'windows_press_key', 'windows_mouse_move', 'mac_mouse_move', 'mac_mouse_click', 'mac_type_text'];
    const isDeterministic = toolTrace.every(t => allowedMacroTools.includes(t.tool));
    if (!isDeterministic || toolTrace.length < 2) return;

    try {
      await fs.mkdir(MACROS_DIR, { recursive: true });
      const llm = await this.getLlm();
      const prompt = `The AI successfully completed the task: "${userIntent}" using the following physical tool trace:\n` +
        JSON.stringify(toolTrace, null, 2) + `\n\n` +
        `Generate a short, concise, unique kebab-case slug for this macro shortcut (e.g., "open-calculator", "mute-volume").\n` +
        `Return ONLY the exact slug string and absolutely nothing else.`;

      const result = await llm.invoke([new HumanMessage(prompt)]);
      let slug = result.content.toString().trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!slug) slug = 'macro-' + Date.now();

      const macro: Macro = {
        name: slug,
        trigger: userIntent.toLowerCase().trim(),
        steps: toolTrace
      };

      const macroPath = path.join(MACROS_DIR, `${slug}.json`);
      await fs.writeFile(macroPath, JSON.stringify(macro, null, 2), 'utf-8');
      console.log(`[LearningEngine] Successfully extracted macro shortcut: ${slug}`);
    } catch (e: any) {
      console.warn(`[LearningEngine] Failed to save macro:`, e.message);
    }
  }

  async matchMacro(userIntent: string): Promise<Macro | null> {
    try {
      if (!fsSync.existsSync(MACROS_DIR)) return null;
      const files = await fs.readdir(MACROS_DIR);
      const normalizedIntent = userIntent.toLowerCase().trim();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const raw = await fs.readFile(path.join(MACROS_DIR, file), 'utf-8');
        try {
          const macro: Macro = JSON.parse(raw);
          // Very strict matching to avoid misfiring
          if (macro.trigger === normalizedIntent) {
            return macro;
          }
        } catch { }
      }
    } catch {
      // Ignored
    }
    return null;
  }

  // ── Auto Skill Creation ────────────────────────────────────────────────────

  /**
   * When the agent fails to complete a task, this generates a SKILL.md file
   * (OpenClaw-compatible frontmatter) in workspace/learned-skills/.
   */
  async createSkillFromFailure(
    taskDescription: string,
    attemptHistory: Array<{ attempt: number; response: string }>,
  ): Promise<string | null> {
    try {
      const llm = await this.getLlm();
      const historyText = attemptHistory
        .map(a => `Attempt ${a.attempt}: ${a.response.substring(0, 300)}`)
        .join('\n\n');

      const existingSkills = await this.listLearnedSkills();
      let existingContext = '';
      if (existingSkills.length > 0) {
        existingContext = `\n\nExisting learned skills:\n` + existingSkills.map(s => `- name: ${s.name}\n  desc: ${s.description}`).join('\n');
      }

      const prompt =
        `You are a skill-creation assistant. The AI agent failed to complete the following task:\n` +
        `"${taskDescription}"\n\n` +
        `Attempt history:\n${historyText}\n\n` +
        `Based on these failures, synthesize what capability is needed and how it could be done. ` +
        `Create a concise skill document in the exact format shown below.\n` +
        `CRITICAL DEDUPLICATION RULE: Review the "Existing learned skills" below. If the capability needed matches the purpose of an existing skill, you MUST exactly reuse its 'name' so we can update it, rather than creating a duplicate! If it's a completely new capability, invent a new kebab-case name.\n` +
        `${existingContext}\n\n` +
        `Format requirements (no extra text outside):\n` +
        `---\n` +
        `name: <kebab-case-skill-name>\n` +
        `description: <one-line description>\n` +
        `---\n\n` +
        `## What the task requires\n` +
        `<explain what capability is needed>\n\n` +
        `## Recommended approach\n` +
        `<step-by-step guidance for next attempt>\n\n` +
        `## Key notes\n` +
        `<any important constraints or caveats>`;

      const result = await llm.invoke([
        new SystemMessage('You create SKILL.md knowledge documents to help the agent learn from failures. You prevent duplicates by updating existing skills if the core purpose overlaps.'),
        new HumanMessage(prompt),
      ]);

      const skillContent = result.content.toString().trim();

      // Parse the name from frontmatter
      const nameMatch = skillContent.match(/^---\s*\nname:\s*(.+)/m);
      const skillName = nameMatch ? slugify(nameMatch[1].trim()) : slugify(taskDescription);

      const skillDir = path.join(LEARNED_SKILLS_DRAFT_DIR, skillName);
      await fs.mkdir(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, 'SKILL.md');

      // Prepend created date if not in LLM output
      let finalContent = skillContent;
      if (!finalContent.includes('created:')) {
        finalContent = finalContent.replace(
          /^---/,
          `---\nstage: draft\ncreated: ${new Date().toISOString().split('T')[0]}`
        );
      }

      await fs.writeFile(skillPath, finalContent, 'utf-8');
      console.log(`[LearningEngine] Created skill file: ${skillPath}`);
      return skillName;
    } catch (err: any) {
      console.error('[LearningEngine] Skill creation failed:', err.message);
      return null;
    }
  }

  // ── List Learned Skills ────────────────────────────────────────────────────

  async listLearnedSkills(): Promise<Array<{ name: string; description: string; content: string; path: string }>> {
    try {
      await fs.mkdir(LEARNED_SKILLS_DRAFT_DIR, { recursive: true });
      await fs.mkdir(LEARNED_SKILLS_VALIDATED_DIR, { recursive: true });
      await fs.mkdir(LEARNED_SKILLS_ENABLED_DIR, { recursive: true });
      const dirs = [LEARNED_SKILLS_DRAFT_DIR, LEARNED_SKILLS_VALIDATED_DIR, LEARNED_SKILLS_ENABLED_DIR];
      const skills = [];
      for (const dir of dirs) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const skillPath = path.join(dir, entry.name, 'SKILL.md');
          try {
            const content = await fs.readFile(skillPath, 'utf-8');
            const nameMatch = content.match(/^name:\s*(.+)/m);
            const descMatch = content.match(/^description:\s*(.+)/m);
            skills.push({
              name: nameMatch?.[1]?.trim() ?? entry.name,
              description: descMatch?.[1]?.trim() ?? '',
              content,
              path: skillPath,
            });
          } catch { /* skip missing */ }
        }
      }

      return skills;
    } catch {
      return [];
    }
  }

  async deleteLearnedSkill(name: string): Promise<boolean> {
    try {
      const slug = slugify(name);
      await fs.rm(path.join(LEARNED_SKILLS_DRAFT_DIR, slug), { recursive: true, force: true });
      await fs.rm(path.join(LEARNED_SKILLS_VALIDATED_DIR, slug), { recursive: true, force: true });
      await fs.rm(path.join(LEARNED_SKILLS_ENABLED_DIR, slug), { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  async promoteLearnedSkill(name: string, targetStage: 'validated' | 'enabled'): Promise<boolean> {
    const slug = slugify(name);
    const fromDraft = path.join(LEARNED_SKILLS_DRAFT_DIR, slug, 'SKILL.md');
    const fromValidated = path.join(LEARNED_SKILLS_VALIDATED_DIR, slug, 'SKILL.md');
    const source = targetStage === 'validated' ? fromDraft : (fsSync.existsSync(fromValidated) ? fromValidated : fromDraft);
    const targetDir = targetStage === 'validated'
      ? path.join(LEARNED_SKILLS_VALIDATED_DIR, slug)
      : path.join(LEARNED_SKILLS_ENABLED_DIR, slug);
    const target = path.join(targetDir, 'SKILL.md');
    try {
      if (!fsSync.existsSync(source)) return false;
      await fs.mkdir(targetDir, { recursive: true });
      let content = await fs.readFile(source, 'utf-8');
      content = content.replace(/^stage:\s*(draft|validated|enabled)\s*$/m, `stage: ${targetStage}`);
      if (!/^stage:\s*/m.test(content)) {
        content = content.replace(/^---/, `---\nstage: ${targetStage}`);
      }
      await fs.writeFile(target, content, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Builds an injection string of all learned skill descriptions for the system prompt.
   */
  async buildLearnedSkillsContext(): Promise<string> {
    const skills = await this.listLearnedSkills();
    if (skills.length === 0) return '';

    const lines = skills.map(s => `<skill><name>${s.name}</name><description>${s.description}</description></skill>`);
    return `\n\nLEARNED SKILLS (knowledge you have acquired from past experiences):\n${lines.join('\n')}`;
  }
}

export const learningEngine = new LearningEngine();
