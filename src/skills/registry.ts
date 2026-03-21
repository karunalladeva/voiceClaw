import * as fs from 'fs';
import * as path from 'path';
import { SkillDefinition, BaseSkill } from './base-skill';

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || path.join(process.cwd(), 'src', 'skills');
  }

  /**
   * Auto-discover and load all skill files from src/skills/.
   * Any .ts/.js file that exports a default class extending BaseSkill is loaded.
   */
  async discover(): Promise<void> {
    console.log(`[SkillRegistry] Scanning for skills in ${this.skillsDir}...`);

    const skipFiles = new Set(['base-skill', 'registry', 'index']);

    const files = fs.readdirSync(this.skillsDir).filter(f => {
      const ext = path.extname(f);
      const name = path.basename(f, ext);
      return (ext === '.ts' || ext === '.js') && !skipFiles.has(name);
    });

    for (const file of files) {
      try {
        const modulePath = path.join(this.skillsDir, file);
        const mod = await import(modulePath);
        const SkillClass = mod.default;

        if (!SkillClass) {
          console.warn(`[SkillRegistry] ${file}: no default export, skipping.`);
          continue;
        }

        const instance: BaseSkill = new SkillClass();
        const definition = await instance.define();

        this.skills.set(definition.id, definition);
        console.log(`[SkillRegistry] Loaded skill: ${definition.name} (${definition.id}) - ${definition.enabled ? 'enabled' : 'disabled'}`);
      } catch (err: any) {
        console.error(`[SkillRegistry] Failed to load skill from ${file}:`, err.message);
      }
    }

    console.log(`[SkillRegistry] Discovery complete. ${this.skills.size} skill(s) loaded.`);
  }

  getSkill(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  getEnabledSkills(): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(s => s.enabled);
  }

  getAllSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  enableSkill(id: string): boolean {
    const skill = this.skills.get(id);
    if (skill) {
      skill.enabled = true;
      return true;
    }
    return false;
  }

  disableSkill(id: string): boolean {
    const skill = this.skills.get(id);
    if (skill) {
      skill.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * Build a routing description string for the main agent to decide which skill to use.
   * The LLM reads this to decide routing.
   */
  buildRoutingPrompt(): string {
    const enabled = this.getEnabledSkills();
    if (enabled.length === 0) return '';

    const lines = enabled.map(s =>
      `- SKILL_ID: "${s.id}" | NAME: "${s.name}" | WHEN TO USE: ${s.triggerDescription}`
    );

    return (
      '\n\nYou have access to specialized skills. If the user\'s request matches a skill, ' +
      'respond ONLY with the JSON: {"route_to_skill": "<SKILL_ID>", "query": "<user\'s original question>"}. ' +
      'If no skill matches, answer directly.\n\nAvailable Skills:\n' +
      lines.join('\n')
    );
  }

  // ── Learned Skills (OpenClaw-style SKILL.md) ─────────────────────────────

  private learnedSkillsDir = path.join(process.cwd(), 'workspace', 'learned-skills');
  private learnedSkillsContext = '';
  private _watcher: import('fs').FSWatcher | null = null;

  /**
   * Reads all workspace/learned-skills/<name>/SKILL.md files and builds an
   * XML-style context string (mirrors OpenClaw's formatSkillsForPrompt).
   */
  async loadLearnedSkills(): Promise<void> {
    try {
      await fs.promises.mkdir(this.learnedSkillsDir, { recursive: true });
      const entries = fs.readdirSync(this.learnedSkillsDir, { withFileTypes: true });
      const parts: string[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = path.join(this.learnedSkillsDir, entry.name, 'SKILL.md');
        try {
          const content = fs.readFileSync(skillPath, 'utf-8');
          const nameMatch = content.match(/^name:\s*(.+)/m);
          const descMatch = content.match(/^description:\s*(.+)/m);
          const name = nameMatch?.[1]?.trim() ?? entry.name;
          const desc = descMatch?.[1]?.trim() ?? '';
          parts.push(`<skill><name>${name}</name><description>${desc}</description></skill>`);
        } catch { /* skip missing */ }
      }

      if (parts.length > 0) {
        this.learnedSkillsContext =
          '\n\nLEARNED SKILLS (knowledge from past experiences):\n' + parts.join('\n');
        console.log(`[SkillRegistry] Loaded ${parts.length} learned skill(s).`);
      } else {
        this.learnedSkillsContext = '';
      }
    } catch (err: any) {
      console.error('[SkillRegistry] Could not load learned skills:', err.message);
    }
  }

  /**
   * Set up a file watcher (250ms debounce, mirrors OpenClaw watchDebounceMs).
   * Auto-reloads learned skills whenever a new SKILL.md appears.
   */
  watchLearnedSkills(): void {
    try {
      fs.promises.mkdir(this.learnedSkillsDir, { recursive: true }).then(() => {
        let debounce: ReturnType<typeof setTimeout> | null = null;
        this._watcher = fs.watch(this.learnedSkillsDir, { recursive: true }, () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => {
            console.log('[SkillRegistry] Learned skills changed — reloading…');
            this.loadLearnedSkills();
          }, 250);
        });
        console.log('[SkillRegistry] Watching for new learned skills.');
      });
    } catch (err: any) {
      console.error('[SkillRegistry] Could not watch learned-skills dir:', err.message);
    }
  }

  /** Returns the learned-skills context snippet to inject into the system prompt. */
  getLearnedSkillsContext(): string {
    return this.learnedSkillsContext;
  }
}

