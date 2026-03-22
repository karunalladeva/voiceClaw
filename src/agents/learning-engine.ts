import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { MCPClientManager } from './mcp-client';
import { modelRouter } from '../models/model-router';

const LEARNED_SKILLS_DIR = path.join(process.cwd(), 'workspace', 'learned-skills');

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

  /**
   * Detects whether the agent's response indicates it cannot complete the task.
   */
  shouldRetry(response: string): boolean {
    const lower = response.toLowerCase();
    return FAILURE_PHRASES.some(phrase => lower.includes(phrase));
  }

  // ── Auto Memory Store ──────────────────────────────────────────────────────

  /**
   * Asks the LLM to extract important facts from the conversation and stores
   * them if any are found. Runs after every successful response.
   */
  async autoExtractAndStore(
    userInput: string,
    agentResponse: string,
    mcpManager: MCPClientManager,
  ): Promise<void> {
    try {
      const llm = await this.getLlm();
      const extractPrompt =
        `You are a memory extraction assistant. Analyze the following conversation exchange and decide:\n` +
        `1. Is there a new, important, storable fact (name, preference, goal, skill learned, decision)?\n` +
        `2. If YES, write a concise memory object as JSON: { "content": "...", "tags": ["tag1"] }\n` +
        `3. If NO, reply with exactly: NO_MEMORY\n\n` +
        `User: ${userInput}\nAgent: ${agentResponse}`;

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
        const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
        await mcpManager.addMemory(parsed.content, tags);
        console.log('[LearningEngine] Auto-stored memory:', parsed.content.substring(0, 60));
      }
    } catch (err: any) {
      console.error('[LearningEngine] Auto-store failed (non-critical):', err.message);
    }
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

      const skillDir = path.join(LEARNED_SKILLS_DIR, skillName);
      await fs.mkdir(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, 'SKILL.md');

      // Prepend created date if not in LLM output
      let finalContent = skillContent;
      if (!finalContent.includes('created:')) {
        finalContent = finalContent.replace(
          /^---/,
          `---\ncreated: ${new Date().toISOString().split('T')[0]}`
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
      await fs.mkdir(LEARNED_SKILLS_DIR, { recursive: true });
      const entries = await fs.readdir(LEARNED_SKILLS_DIR, { withFileTypes: true });
      const skills = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = path.join(LEARNED_SKILLS_DIR, entry.name, 'SKILL.md');
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

      return skills;
    } catch {
      return [];
    }
  }

  async deleteLearnedSkill(name: string): Promise<boolean> {
    try {
      const skillDir = path.join(LEARNED_SKILLS_DIR, slugify(name));
      await fs.rm(skillDir, { recursive: true, force: true });
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
