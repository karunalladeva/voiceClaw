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
   * Auto-discover and load all default and on-demand skill files.
   */
  async discover(): Promise<void> {
    const { SkillLoader } = await import('../loaders/skill-loader');
    
    const defaults = await SkillLoader.loadDefaultSkills(this.skillsDir);
    defaults.forEach(def => this.skills.set(def.id, def));

    const onDemands = await SkillLoader.loadOnDemandSkills();
    onDemands.forEach(def => this.skills.set(def.id, def));

    console.log(`[SkillRegistry] Discovery complete. ${this.skills.size} native skill(s) loaded.`);
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

    return `
<skills>
You have access to specialized skills via the NATIVE JSON tool function named \`route_to_skill\`. 
CRITICAL: DO NOT write python scripts, shell commands, or use \`shell_exec\` to launch skills. You must directly invoke the JSON \`route_to_skill\` function provided in your tool schema!

If the user's request matches a skill below, invoke \`route_to_skill\` with the corresponding SKILL_ID.

Available Skills:
${lines.join('\n')}
</skills>`;
  }

  // ── Learned Skills (OpenClaw-style SKILL.md) ─────────────────────────────

  private learnedSkillsDir = path.join(process.cwd(), 'workspace', 'learned-skills');
  private learnedSkillsContext = '';
  private _watcher: import('fs').FSWatcher | null = null;

  async loadLearnedSkills(): Promise<void> {
    const { SkillLoader } = await import('../loaders/skill-loader');
    this.learnedSkillsContext = await SkillLoader.loadLearnedSkills(this.learnedSkillsDir);
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

