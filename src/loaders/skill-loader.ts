import * as fs from 'fs';
import * as path from 'path';
import { BaseSkill, SkillDefinition } from '../skills/base-skill';
import { resolveToolsByIds } from '../skills/tool-resolver';

type SkillManifestEntry = {
  id: string;
  name: string;
  description: string;
  triggerDescription: string;
  systemPrompt: string;
  tools?: string[];
  enabled?: boolean;
  model?: string;
  temperature?: number;
  category?: string;
  tags?: string[];
  dependencies?: string[];
};

export class SkillLoader {
  static async loadDefaultSkills(skillsDir?: string): Promise<SkillDefinition[]> {
    const dir = skillsDir || path.join(process.cwd(), 'src', 'skills');
    console.log(`[SkillLoader] Scanning for default skills in ${dir}...`);
    const loadedSkills: SkillDefinition[] = [];

    if (!fs.existsSync(dir)) return loadedSkills;

    const skipFiles = new Set(['base-skill', 'registry', 'index', 'loader', 'ondemand', 'tool-resolver']);

    const files = this.collectSkillModuleFiles(dir, skipFiles);

    for (const file of files) {
      try {
        const modulePath = file;
        const mod = await import(modulePath);
        const SkillClass = mod.default;

        if (!SkillClass) {
          console.warn(`[SkillLoader] ${file}: no default export, skipping.`);
          continue;
        }

        const instance: BaseSkill = new SkillClass();
        const definition = await instance.define();
        loadedSkills.push(definition);
        console.log(`[SkillLoader] Loaded skill: ${definition.name} (${definition.id}) - ${definition.enabled ? 'enabled' : 'disabled'}`);
      } catch (err: any) {
        console.error(`[SkillLoader] Failed to load skill from ${file}:`, err.message);
      }
    }

    const manifestSkills = this.loadManifestSkills(dir);
    manifestSkills.forEach((skill: SkillDefinition) => loadedSkills.push(skill));
    
    return loadedSkills;
  }

  private static collectSkillModuleFiles(
    rootDir: string,
    skipFiles: Set<string>,
    acc: string[] = [],
  ): string[] {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        this.collectSkillModuleFiles(abs, skipFiles, acc);
        continue;
      }
      const ext = path.extname(entry.name);
      const name = path.basename(entry.name, ext);
      if ((ext === '.ts' || ext === '.js') && !skipFiles.has(name) && !entry.name.endsWith('.d.ts')) {
        if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.test.ts')) continue;
        acc.push(abs);
      }
    }
    return acc;
  }

  private static loadManifestSkills(skillsDir: string): SkillDefinition[] {
    const loaded: SkillDefinition[] = [];
    const manifestFiles = this.collectManifestFiles(skillsDir);
    for (const manifestPath of manifestFiles) {
      try {
        const raw = fs.readFileSync(manifestPath, 'utf-8');
        const entries = JSON.parse(raw) as SkillManifestEntry[];
        for (const entry of entries) {
          if (!entry.id || !entry.name || !entry.systemPrompt) continue;
          loaded.push({
            id: entry.id,
            name: entry.name,
            description: entry.description,
            category: entry.category,
            tags: entry.tags || [],
            dependencies: entry.dependencies || [],
            triggerDescription: entry.triggerDescription,
            systemPrompt: entry.systemPrompt,
            tools: resolveToolsByIds(entry.tools || []),
            enabled: entry.enabled ?? true,
            model: entry.model,
            temperature: entry.temperature,
          });
        }
      } catch (err: any) {
        console.error(`[SkillLoader] Failed to parse manifest ${manifestPath}:`, err.message);
      }
    }
    return loaded;
  }

  private static collectManifestFiles(rootDir: string, acc: string[] = []): string[] {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        this.collectManifestFiles(abs, acc);
      } else if (entry.isFile() && entry.name === 'skill-manifest.json') {
        acc.push(abs);
      }
    }
    return acc;
  }

  static async loadLearnedSkills(learnedSkillsDir?: string): Promise<string> {
    const dir = learnedSkillsDir || path.join(process.cwd(), 'workspace', 'learned-skills');
    try {
      if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true });
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const parts: string[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = path.join(dir, entry.name, 'SKILL.md');
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
        console.log(`[SkillLoader] Loaded ${parts.length} learned skill(s).`);
        return `\n<learned_skills>\n${parts.join('\n')}\n</learned_skills>`;
      }
    } catch (err: any) {
      console.error('[SkillLoader] Could not load learned skills:', err.message);
    }
    return '';
  }

  static parseSkillMarkdown(content: string): {
    name?: string;
    description?: string;
    systemPrompt: string;
    triggerDescription: string;
  } {
    const trimmed = content.trim();
    const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
      return {
        systemPrompt: trimmed,
        triggerDescription: trimmed.slice(0, 240),
      };
    }
    const frontmatter = match[1];
    const body = match[2].trim();
    const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
    const desc = description || body.slice(0, 240);
    return {
      name,
      description: desc,
      systemPrompt: body || desc,
      triggerDescription: desc,
    };
  }

  /**
   * Approved and draft creator skills from workspace/skills (Creator dashboard).
   */
  static async loadCreatorWorkspaceSkills(): Promise<SkillDefinition[]> {
    const loaded: SkillDefinition[] = [];
    try {
      const { listCreatorItems } = await import('../creator/workspace-creator');
      const items = await listCreatorItems('skill');
      const skillsRoot = path.join(process.cwd(), 'workspace', 'skills');
      for (const item of items) {
        const skillPath = path.join(skillsRoot, item.slug, 'SKILL.md');
        let content = '';
        try {
          content = fs.readFileSync(skillPath, 'utf-8');
        } catch {
          continue;
        }
        const parsed = this.parseSkillMarkdown(content);
        const enabled = item.status === 'approved';
        loaded.push({
          id: `creator-${item.slug}`,
          name: parsed.name || item.name,
          description:
            parsed.description ||
            item.notes ||
            `Workspace creator skill (${item.purpose}, ${item.status})`,
          category: 'creator',
          tags: ['creator', item.purpose, item.status],
          dependencies: [],
          triggerDescription: parsed.triggerDescription,
          systemPrompt: parsed.systemPrompt || content,
          tools: resolveToolsByIds([]),
          enabled,
        });
      }
      if (loaded.length > 0) {
        console.log(`[SkillLoader] Loaded ${loaded.length} creator workspace skill(s).`);
      }
    } catch (err: any) {
      console.error('[SkillLoader] Could not load creator workspace skills:', err.message);
    }
    return loaded;
  }

  static async loadOnDemandSkills(onDemandDir?: string): Promise<SkillDefinition[]> {
    const dir = onDemandDir || path.join(process.cwd(), 'workspace', 'ondemand-skills');
    const loadedSkills: SkillDefinition[] = [];
    try {
      if (!fs.existsSync(dir)) return loadedSkills;
      
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
      for (const file of files) {
        try {
          const mod = await import(path.join(dir, file));
          if (mod.default) {
            const instance: BaseSkill = new mod.default();
            loadedSkills.push(await instance.define());
          }
        } catch (e: any) {
          console.error(`[SkillLoader] Failed to load ondemand skill ${file}:`, e.message);
        }
      }
    } catch (err: any) {
      console.error('[SkillLoader] Could not load ondemand skills:', err.message);
    }
    return loadedSkills;
  }
}
