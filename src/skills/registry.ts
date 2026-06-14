import * as fs from 'fs';
import * as path from 'path';
import { SkillDefinition, BaseSkill } from './base-skill';
import {
  isCasualMessage,
  isSynthesisOverProvidedData,
  isTradingRelatedQuery,
} from '../agents/prompt-context';
import { isGeneralLane, type MicroRouteResult } from '../agents/micro-router';

export type SkillRoutingMode = 'auto' | 'compact' | 'standard' | 'trading-focused' | 'synthesis';

const TRADING_SKILL_PREFIX = 'trading-';
const MAX_RANKED_TRADING_SKILLS = 10;
const MAX_MICRO_ROUTE_SKILLS = 10;
const MAX_MICRO_ROUTE_TOOLS = 8;

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();
  private skillsDir: string;
  private tradingCatalogText = '';

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

    await this.reloadCreatorWorkspaceSkills();

    this.rebuildTradingCatalog();
    console.log(`[SkillRegistry] Discovery complete. ${this.skills.size} native skill(s) loaded.`);
  }

  /** Reload workspace/skills from Creator (approved + draft metadata). */
  async reloadCreatorWorkspaceSkills(): Promise<number> {
    const { SkillLoader } = await import('../loaders/skill-loader');
    const creatorSkills = await SkillLoader.loadCreatorWorkspaceSkills();
    for (const def of creatorSkills) {
      this.skills.set(def.id, def);
    }
    this.rebuildTradingCatalog();
    return creatorSkills.length;
  }

  private rebuildTradingCatalog(): void {
    const trading = this.getEnabledSkills().filter((s) => s.id.startsWith(TRADING_SKILL_PREFIX));
    const byCategory = new Map<string, string[]>();
    for (const skill of trading) {
      const category = skill.category || 'general';
      const bucket = byCategory.get(category) || [];
      bucket.push(skill.id);
      byCategory.set(category, bucket);
    }
    const lines = Array.from(byCategory.entries()).map(
      ([category, ids]) => `- ${category}: ${ids.join(', ')}`,
    );
    this.tradingCatalogText = lines.join('\n');
  }

  private rankSkillsForQuery(skills: SkillDefinition[], query: string): SkillDefinition[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return skills;
    const tokens = normalized.split(/\s+/).filter((w) => w.length > 2);
    const tickerTokens = normalized.match(/\b[A-Z]{1,5}\b/g)?.map((t) => t.toLowerCase()) || [];
    const scored = skills.map((skill) => {
      const haystack = [
        skill.id,
        skill.name,
        skill.description,
        skill.triggerDescription,
        ...(skill.tags || []),
      ]
        .join(' ')
        .toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += 3;
      }
      for (const ticker of tickerTokens) {
        if (haystack.includes(ticker)) score += 2;
      }
      if (haystack.includes(normalized)) score += 5;
      return { skill, score };
    });
    return scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.skill);
  }

  private formatSkillLine(skill: SkillDefinition): string {
    return `- SKILL_ID: "${skill.id}" | NAME: "${skill.name}" | WHEN TO USE: ${skill.triggerDescription}`;
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
   * Build a routing description for the main agent. Core skills are always listed;
   * trading skills use a compact catalog plus query-matched detail when relevant.
   */
  buildRoutingPrompt(
    userQuery?: string,
    allowedSkillIds?: string[],
    mode: SkillRoutingMode = 'auto',
    microRoute?: MicroRouteResult,
  ): string {
    let enabled = this.getEnabledSkills();
    if (allowedSkillIds && allowedSkillIds.length > 0) {
      const allow = new Set(allowedSkillIds);
      enabled = enabled.filter(s => allow.has(s.id));
    }
    if (enabled.length === 0) return '';

    const query = (userQuery || '').trim();
    const casual = isCasualMessage(query);
    const tradingQuery = isTradingRelatedQuery(query);
    const synthesis = mode === 'synthesis' || (mode === 'auto' && isSynthesisOverProvidedData(query));

    let core = enabled.filter((s) => !s.id.startsWith(TRADING_SKILL_PREFIX));
    const trading = enabled.filter((s) => s.id.startsWith(TRADING_SKILL_PREFIX));

    if (microRoute && !isGeneralLane(microRoute.category) && microRoute.rankedSkillIds.length > 0) {
      const focusIds = new Set(microRoute.rankedSkillIds);
      const focused = core.filter((s) => focusIds.has(s.id));
      const ranked = this.rankSkillsForQuery(focused.length > 0 ? focused : core, query);
      core = (ranked.length > 0 ? ranked : focused).slice(0, MAX_MICRO_ROUTE_SKILLS);
    } else if (microRoute && !isGeneralLane(microRoute.category)) {
      const ranked = this.rankSkillsForQuery(core, query);
      if (ranked.length > 0) core = ranked.slice(0, MAX_MICRO_ROUTE_SKILLS);
    } else if (microRoute && isGeneralLane(microRoute.category) && microRoute.rankedSkillIds.length > 0 && !casual) {
      core = this.prioritizeSkillsByIds(core, microRoute.rankedSkillIds);
    }

    const coreLines = core.map((s) => this.formatSkillLine(s));

    let tradingSection: string;
    if (synthesis) {
      tradingSection = `<trading_catalog synthesis="true">
Market OHLCV and news for this task are already in the user message (## Market data for … blocks).
Do NOT call yahoo_ohlcv, yahoo_news, or route_to_skill unless a symbol block is missing or the user asks for more symbols.
Write the analysis from the provided blocks only.
</trading_catalog>`;
    } else if (casual && !tradingQuery) {
      tradingSection = `<trading_catalog compact="true">
Trading specialists use ids starting with "trading-" via route_to_skill.
For general market questions use voiceclaw-financial-analyst (listed above).
Full trading catalog (by category):
${this.tradingCatalogText || '(none)'}
</trading_catalog>`;
    } else {
      const ranked = this.rankSkillsForQuery(trading, query);
      const detailed = (ranked.length > 0 ? ranked : trading).slice(0, MAX_RANKED_TRADING_SKILLS);
      const detailedLines = detailed.map((s) => this.formatSkillLine(s));
      tradingSection = `<trading_catalog>
All trading skill ids are prefixed with "trading-". Categories:
${this.tradingCatalogText || '(none)'}
</trading_catalog>
${detailedLines.length > 0 ? `\nRelevant trading skills for this message:\n${detailedLines.join('\n')}` : ''}`;
    }

    let routingMode: string;
    if (synthesis) routingMode = 'synthesis';
    else if (microRoute && !isGeneralLane(microRoute.category)) routingMode = `micro-${microRoute.category}`;
    else if (mode !== 'auto') routingMode = mode;
    else routingMode = casual && !tradingQuery ? 'compact' : tradingQuery ? 'trading-focused' : 'standard';

    const microRouteBlock =
      microRoute && !isGeneralLane(microRoute.category)
        ? this.buildMicroRouteBlock(microRoute)
        : microRoute && isGeneralLane(microRoute.category) && microRoute.matches.length > 0
          ? this.buildGeneralRouteBlock(microRoute)
          : '';

    const microToolsBlock =
      microRoute && microRoute.rankedToolNames.length > 0
        ? this.buildMicroRouteToolsBlock(microRoute, query)
        : '';

    const coreHeading =
      microRoute && !isGeneralLane(microRoute.category)
        ? 'Focused skills for this request (route via route_to_skill):'
        : microRoute && isGeneralLane(microRoute.category) && microRoute.rankedSkillIds.length > 0
          ? 'Core skills (catalog-ranked for this message; full list below):'
          : 'Core skills (always available):';

    return `
${microRouteBlock}${microToolsBlock}<skills routing="${routingMode}">
You have specialized skills via the NATIVE JSON tool \`route_to_skill\`.
CRITICAL: DO NOT use shell_exec or scripts to launch skills — call \`route_to_skill\` directly with skillId and query.

${coreHeading}
${coreLines.join('\n')}

${tradingSection}
</skills>`;
  }

  private prioritizeSkillsByIds(skills: SkillDefinition[], orderedIds: string[]): SkillDefinition[] {
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    const matched = skills.filter((s) => rank.has(s.id));
    const rest = skills.filter((s) => !rank.has(s.id));
    matched.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return [...matched, ...rest];
  }

  private buildGeneralRouteBlock(route: MicroRouteResult): string {
    const topSkills = route.rankedSkillIds.slice(0, 5).join(', ') || '(see ranked skills below)';
    const topTools = route.rankedToolNames.slice(0, 5).join(', ') || '(see tools below)';
    return `<micro_route lane="general" confidence="${route.confidence.toFixed(2)}">
General assistant lane. Prefer catalog matches: skills → ${topSkills}; tools → ${topTools}.
Use route_to_skill or native/MCP tools directly — full skill catalog remains available below.
</micro_route>
`;
  }

  private buildMicroRouteBlock(route: MicroRouteResult): string {
    const topSkills = route.rankedSkillIds.slice(0, 5).join(', ') || '(see focused skills below)';
    const lane = route.category;
    return `<micro_route lane="${lane}" confidence="${route.confidence.toFixed(2)}">
Specialist lane "${lane}" (from live catalog). Prefer route_to_skill → ${topSkills}, or matched native/MCP tools below.
Do not browse unrelated skills — act on the first turn.
</micro_route>
`;
  }

  private buildMicroRouteToolsBlock(route: MicroRouteResult, query: string): string {
    const lines: string[] = [];
    const seen = new Set<string>();

    for (const match of route.matches) {
      if (match.kind !== 'skill') {
        if (seen.has(match.id)) continue;
        seen.add(match.id);
        lines.push(`- ${match.id}: ${match.hint}`);
      } else {
        const skill = this.getSkill(match.id);
        if (!skill) continue;
        for (const tool of skill.tools) {
          const name = tool?.name;
          if (!name || seen.has(name)) continue;
          seen.add(name);
          lines.push(`- ${name} (skill ${match.id})`);
        }
      }
      if (lines.length >= MAX_MICRO_ROUTE_TOOLS) break;
    }

    if (!lines.length) return '';

    return `<micro_route_tools query="${query.slice(0, 80).replace(/"/g, "'")}">
Relevant native + MCP tools for this message (call directly — not shell_exec):
${lines.join('\n')}
</micro_route_tools>
`;
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

