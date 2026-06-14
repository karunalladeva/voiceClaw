import { DynamicStructuredTool } from '@langchain/core/tools';
import { SkillDefinition } from '../skills/base-skill';
import { bm25RankIndices, tokenize } from '../utils/bm25';

/** Only fixed lane — every other lane id is derived from the live catalog. */
export const GENERAL_LANE = 'general';

export type MicroRouteLane = string;

export type RoutableKind = 'skill' | 'native_tool' | 'mcp_tool';

export interface RoutableEntry {
  id: string;
  kind: RoutableKind;
  label: string;
  document: string;
  laneHints: MicroRouteLane[];
  toolNames: string[];
  description: string;
}

export interface CatalogMatch {
  entry: RoutableEntry;
  score: number;
}

const TRADING_SKILL_PREFIX = 'trading-';
const MCP_TOOL_PREFIX = /^([^_]+)_/;

const GENERAL_CORE_SKILL_IDS = new Set([
  'web-researcher',
  'file-manager',
  'screen-reader',
  'os-controller',
  'browser-controller',
  'shell-commander',
  'scheduler',
  'voiceclaw-financial-analyst',
  'android-controller',
]);

const AUTOMATION_SKILL_IDS = new Set([
  'os-controller',
  'shell-commander',
  'browser-controller',
  'android-controller',
  'screen-reader',
]);

/** Query reads like a general assistant task (not a specialist media/design phrase). */
const GENERAL_QUERY_SIGNALS =
  /\b(what|who|when|where|why|how|explain|tell me|help me|help with|weather|forecast|temperature|news|headline|score|match|price|stock|market|trade|portfolio|file|folder|read|write|save|screen|memory|remember|schedule|remind|task|orchestr|pipeline|browse|search|lookup|summarize|summary|analyze|compare|calculate|convert|translate|define|list|show|open|run|execute|check|status|debug|fix|error|code|script|api|database|email|message|channel|discord|telegram|whatsapp)\b/i;
const SPECIALIST_QUERY_SIGNALS =
  /\b(comfyui|txt2img|draw\s+(me\s+)?(a|an|the)|generate\s+(an?\s+)?(image|video|picture)|etsy\s+listing|gumroad\s+cover|listing\s+tags|mockup\s+design|printable\s+planner)\b/i;

export function isGeneralLane(lane: MicroRouteLane): boolean {
  return lane === GENERAL_LANE;
}

export function slugLane(value: string): MicroRouteLane {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || GENERAL_LANE;
}

export function skillToolNames(skill: SkillDefinition): string[] {
  if (!Array.isArray(skill.tools)) return [];
  return skill.tools
    .map((t) => (typeof t === 'object' && t?.name ? String(t.name) : ''))
    .filter(Boolean);
}

function laneFromToolName(name: string): MicroRouteLane[] {
  const lanes = new Set<MicroRouteLane>();
  if (name.startsWith('comfyui_')) lanes.add('comfyui');
  if (/^yahoo_|^ccxt_/.test(name)) lanes.add('markets');
  if (name.startsWith('web_')) lanes.add('research');
  if (name.startsWith('pdf_')) lanes.add('documents');
  if (/^(read_|write_|list_)/.test(name)) lanes.add('files');
  if (/^(shell_|mouse_|keyboard_)/.test(name)) lanes.add('automation');
  if (/^(deliver_|list_channels)/.test(name)) lanes.add('channels');
  if (/memory|finance/i.test(name)) lanes.add('memory');
  const mcp = name.match(MCP_TOOL_PREFIX);
  if (mcp?.[1]) lanes.add(slugLane(`mcp-${mcp[1]}`));
  return [...lanes];
}

function inferLaneHintsForSkill(skill: SkillDefinition): MicroRouteLane[] {
  const tools = skillToolNames(skill);
  const lanes = new Set<MicroRouteLane>();

  if (skill.id.startsWith(TRADING_SKILL_PREFIX)) lanes.add('trading');
  if (skill.category) lanes.add(slugLane(skill.category));
  if (skill.id.startsWith('creator-')) lanes.add('creator');
  if (skill.id.includes('comfyui') || tools.some((n) => n.startsWith('comfyui_'))) lanes.add('comfyui');
  if (AUTOMATION_SKILL_IDS.has(skill.id)) lanes.add('automation');
  if (skill.id === 'web-researcher' || tools.some((n) => n.startsWith('web_'))) lanes.add('research');
  if (skill.id === 'voiceclaw-financial-analyst' || tools.some((n) => /^yahoo_|^ccxt_/.test(n))) {
    lanes.add('markets');
  }
  if (skill.id === 'file-manager' || tools.some((n) => /^(read_|write_|list_)/.test(n))) lanes.add('files');
  if (tools.some((n) => n.startsWith('pdf_'))) lanes.add('documents');

  for (const toolName of tools) {
    for (const lane of laneFromToolName(toolName)) lanes.add(lane);
  }

  if (lanes.size === 0 || GENERAL_CORE_SKILL_IDS.has(skill.id)) {
    lanes.add(GENERAL_LANE);
  }
  return [...lanes];
}

function inferLaneHintsForTool(name: string, description: string): MicroRouteLane[] {
  const lanes = new Set<MicroRouteLane>(laneFromToolName(name));
  const hay = `${name} ${description}`.toLowerCase();
  if (/\b(etsy|gumroad|listing|mockup|printable|planner)\b/.test(hay)) lanes.add('digital-products');
  if (lanes.size === 0) lanes.add(GENERAL_LANE);
  return [...lanes];
}

function toolKind(name: string): RoutableKind {
  return MCP_TOOL_PREFIX.test(name) && name.includes('_') ? 'mcp_tool' : 'native_tool';
}

function skillDocument(skill: SkillDefinition): string {
  const tools = skillToolNames(skill).join(' ');
  const artBoost =
    skill.id.includes('comfyui') || tools.includes('comfyui_')
      ? 'draw sketch paint illustrate generate image video animation visual artwork scene landscape portrait'
      : '';
  const researchBoost =
    skill.id === 'web-researcher' || tools.includes('web_search')
      ? 'search the web browse online lookup news research fetch'
      : '';
  const generalBoost =
    GENERAL_CORE_SKILL_IDS.has(skill.id) || skill.id.startsWith(TRADING_SKILL_PREFIX)
      ? 'question answer help chat general task orchestration research file screen memory schedule trade market analysis'
      : '';
  return [
    skill.id,
    skill.name,
    skill.category ?? '',
    (skill.tags ?? []).join(' '),
    skill.triggerDescription,
    skill.description,
    tools,
    artBoost,
    researchBoost,
    generalBoost,
  ]
    .join(' ')
    .trim();
}

export function buildRoutableCatalog(
  skills: SkillDefinition[],
  tools: DynamicStructuredTool[],
): RoutableEntry[] {
  const entries: RoutableEntry[] = [];
  const seenToolNames = new Set<string>();

  for (const skill of skills) {
    if (!skill.enabled) continue;
    const toolNames = skillToolNames(skill);
    entries.push({
      id: skill.id,
      kind: 'skill',
      label: skill.name,
      document: skillDocument(skill),
      laneHints: inferLaneHintsForSkill(skill),
      toolNames,
      description: skill.triggerDescription || skill.description,
    });
  }

  for (const tool of tools) {
    const name = tool.name;
    if (!name || seenToolNames.has(name)) continue;
    seenToolNames.add(name);
    const description = String(tool.description ?? '');
    const kind = toolKind(name);
    entries.push({
      id: name,
      kind,
      label: name,
      document: `${name} ${description}`.trim(),
      laneHints: inferLaneHintsForTool(name, description),
      toolNames: [name],
      description: description || `Tool ${name}`,
    });
  }

  return entries;
}

export function collectCatalogLanes(catalog: RoutableEntry[]): MicroRouteLane[] {
  const lanes = new Set<MicroRouteLane>([GENERAL_LANE]);
  for (const entry of catalog) {
    for (const lane of entry.laneHints) lanes.add(lane);
  }
  return [...lanes].sort();
}

function bm25HitScore(query: string, document: string): number {
  const qTokens = tokenize(query);
  if (!qTokens.length) return 0;
  const docTokens = new Set(tokenize(document));
  let hits = 0;
  for (const t of qTokens) {
    if (docTokens.has(t)) hits += 1;
  }
  return hits / qTokens.length;
}

export function rankCatalogMatches(
  catalog: RoutableEntry[],
  query: string,
  maxResults = 12,
): CatalogMatch[] {
  if (!catalog.length || !query.trim()) return [];
  const docs = catalog.map((e) => e.document);
  const rankedIndices = bm25RankIndices(docs, query);
  const scored: CatalogMatch[] = rankedIndices.map((idx) => ({
    entry: catalog[idx]!,
    score: bm25HitScore(query, catalog[idx]!.document),
  }));
  return scored.filter((m) => m.score > 0).slice(0, maxResults);
}

export function queryGeneralLaneBoost(query: string): number {
  const text = query.trim().toLowerCase();
  if (!text) return 0.15;
  if (SPECIALIST_QUERY_SIGNALS.test(text)) return 0;
  let boost = 0;
  if (GENERAL_QUERY_SIGNALS.test(text)) boost += 0.18;
  if (/\?/.test(text)) boost += 0.06;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 5) boost += 0.04;
  return boost;
}

export function inferLaneFromMatches(
  matches: CatalogMatch[],
  query: string,
  options?: { generalLaneBias?: number; specialistMinMargin?: number },
): {
  lane: MicroRouteLane;
  confidence: number;
} {
  const generalLaneBias = options?.generalLaneBias ?? 0.12;
  const specialistMinMargin = options?.specialistMinMargin ?? 0.1;
  const weights: Record<string, number> = {
    [GENERAL_LANE]: queryGeneralLaneBoost(query) + generalLaneBias,
  };

  if (!matches.length) {
    return { lane: GENERAL_LANE, confidence: 0.55 };
  }

  for (const match of matches.slice(0, 10)) {
    const weight = match.score;
    const hints = match.entry.laneHints;
    const nonGeneralHints = hints.filter((h) => h !== GENERAL_LANE);
    const isGeneralPrimary =
      nonGeneralHints.length === 0 ||
      GENERAL_CORE_SKILL_IDS.has(match.entry.id);

    if (isGeneralPrimary) {
      weights[GENERAL_LANE] = (weights[GENERAL_LANE] ?? 0) + weight * 1.25;
      for (const lane of nonGeneralHints) {
        weights[lane] = (weights[lane] ?? 0) + weight * 0.5;
      }
      continue;
    }

    for (const lane of hints) {
      weights[lane] = (weights[lane] ?? 0) + weight;
    }
    if (hints.includes(GENERAL_LANE)) {
      weights[GENERAL_LANE] = (weights[GENERAL_LANE] ?? 0) + weight * 0.35;
    }
  }

  const ordered = Object.entries(weights).sort((a, b) => b[1] - a[1]);
  const top = ordered[0]!;
  const generalWeight = weights[GENERAL_LANE] ?? 0;
  const specialistTop = ordered.find(([lane]) => lane !== GENERAL_LANE) ?? [GENERAL_LANE, 0];
  const specialistMargin = specialistTop[1] - generalWeight;

  if (top[1] < 0.06) {
    return { lane: GENERAL_LANE, confidence: 0.5 };
  }

  if (
    top[0] !== GENERAL_LANE &&
    specialistMargin < specialistMinMargin &&
    !SPECIALIST_QUERY_SIGNALS.test(query)
  ) {
    return { lane: GENERAL_LANE, confidence: Math.min(0.85, generalWeight + 0.1) };
  }

  const second = ordered[1] ?? [GENERAL_LANE, 0];
  const margin = top[1] - second[1];
  const confidence = Math.min(0.99, Math.max(0.35, top[1] + margin));
  return { lane: top[0], confidence };
}

export function extractRankedIds(matches: CatalogMatch[]): {
  rankedSkillIds: string[];
  rankedToolNames: string[];
} {
  const rankedSkillIds: string[] = [];
  const rankedToolNames: string[] = [];
  const seenSkills = new Set<string>();
  const seenTools = new Set<string>();

  for (const { entry } of matches) {
    if (entry.kind === 'skill') {
      if (!seenSkills.has(entry.id)) {
        seenSkills.add(entry.id);
        rankedSkillIds.push(entry.id);
      }
      for (const toolName of entry.toolNames) {
        if (!seenTools.has(toolName)) {
          seenTools.add(toolName);
          rankedToolNames.push(toolName);
        }
      }
      continue;
    }
    if (!seenTools.has(entry.id)) {
      seenTools.add(entry.id);
      rankedToolNames.push(entry.id);
    }
  }

  return { rankedSkillIds, rankedToolNames };
}

export function catalogFingerprint(skills: SkillDefinition[], tools: DynamicStructuredTool[]): string {
  const skillIds = skills
    .filter((s) => s.enabled)
    .map((s) => s.id)
    .sort()
    .join(',');
  const toolNames = tools
    .map((t) => t.name)
    .sort()
    .join(',');
  return `${skillIds}|${toolNames}`;
}
