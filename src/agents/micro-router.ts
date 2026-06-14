import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { configManager } from '../config/index';
import { modelRouter } from '../models/model-router';
import { SkillDefinition } from '../skills/base-skill';
import {
  buildRoutableCatalog,
  catalogFingerprint,
  collectCatalogLanes,
  extractRankedIds,
  GENERAL_LANE,
  inferLaneFromMatches,
  isGeneralLane,
  rankCatalogMatches,
  slugLane,
  type CatalogMatch,
  type MicroRouteLane,
  type RoutableEntry,
} from './micro-router-catalog';
import {
  isCasualMessage,
  isTradingRelatedQuery,
  isSynthesisOverProvidedData,
} from './prompt-context';
import {
  invalidateMicroRouterModelWarm,
  resolveMicroRouterModelConfig,
  warmMicroRouterModel,
} from './micro-router-model';
import { isLocalProvider } from '../models/local-model-lifecycle';

/** @deprecated Use MicroRouteLane — lanes are dynamic strings from the catalog. */
export type MicroRouteCategory = MicroRouteLane;

export type MicroRouteMethod = 'rule' | 'bm25' | 'catalog' | 'llm' | 'disabled';

export interface MicroRouteMatch {
  id: string;
  kind: 'skill' | 'native_tool' | 'mcp_tool';
  score: number;
  label: string;
  hint: string;
}

export interface MicroRouterContext {
  skills: SkillDefinition[];
  tools: DynamicStructuredTool[];
}

export interface MicroRouteResult {
  /** Dynamic lane id from catalog (e.g. trading, comfyui, digital-products, research, mcp-server_0). */
  category: MicroRouteLane;
  method: MicroRouteMethod;
  confidence: number;
  matches: MicroRouteMatch[];
  rankedSkillIds: string[];
  rankedToolNames: string[];
}

const COMFYUI_RULE =
  /\b(comfyui|txt2img|txt2video|text[\s-]?to[\s-]?image|text[\s-]?to[\s-]?video|stable[\s-]?diffusion|flux[\s-]?dev)\b/i;
const COMFYUI_INTENT =
  /\b(draw|generate|create|make|render|illustrate|paint)\b.{0,40}\b(image|picture|photo|illustration|artwork|poster|wallpaper|avatar|video|animation|gif)\b/i;
const COMFYUI_INTENT_REV =
  /\b(image|picture|photo|illustration|artwork|poster|wallpaper|avatar|video|animation|gif)\b.{0,40}\b(draw|generate|create|make|render|illustrate|paint)\b/i;
const COMFYUI_DRAW_SIMPLE =
  /\b(draw|sketch|paint|illustrate|render)\s+(me\s+)?(a|an|the)\b/i;
const DESIGN_UI_RULE =
  /\b(etsy[\s-]?(listing|tags|seo)|gumroad[\s-]?(cover|page)|listing[\s-]?optimi|mockup[\s-]?design|product[\s-]?page|shop[\s-]?banner|canva[\s-]?template|printable[\s-]?planner|notion[\s-]?template|digital[\s-]?download[\s-]?listing)\b/i;
const DESIGN_UI_INTENT =
  /\b(design|layout|wireframe|typography|branding)\b.{0,30}\b(ui|mockup|listing|cover|thumbnail|template|planner|printable)\b/i;
const WEB_RESEARCH_RULE =
  /\b(search the web|web search|browse (the )?web|look up online|google for|find (articles|sources|pages) (on|about)|web_fetch|web_search)\b/i;
const GENERAL_INTENT_RULE =
  /\b(what is|what are|what's|who is|who are|how do|how to|why is|why are|explain|tell me about|help me|can you|could you|weather|forecast|temperature|read (the )?file|write (a )?file|on my screen|remember that|set (a )?reminder|schedule|run (the )?task|check (my )?email)\b/i;

const routeCache = new Map<string, { result: MicroRouteResult; expiresAt: number }>();
let cachedCatalog: RoutableEntry[] = [];
let cachedCatalogKey = '';

function getMicroRouterConfig() {
  const agent = configManager.getConfig().agent ?? {};
  const mr = agent.microRouter ?? {};
  return {
    enabled: mr.enabled !== false,
    useLlmFallback: mr.useLlmFallback !== false,
    keepAlive: mr.keepAlive !== false,
    modelId: mr.modelId?.trim() || undefined,
    bm25MarginThreshold: typeof mr.bm25MarginThreshold === 'number' ? mr.bm25MarginThreshold : 0.12,
    cacheTtlMs: typeof mr.cacheTtlMs === 'number' ? mr.cacheTtlMs : 120_000,
    maxMatches: typeof mr.maxMatches === 'number' ? mr.maxMatches : 12,
    generalLaneBias: typeof mr.generalLaneBias === 'number' ? mr.generalLaneBias : 0.12,
    specialistMinMargin: typeof mr.specialistMinMargin === 'number' ? mr.specialistMinMargin : 0.1,
  };
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function emptyResult(lane: MicroRouteLane, method: MicroRouteMethod, confidence: number): MicroRouteResult {
  return {
    category: lane,
    method,
    confidence,
    matches: [],
    rankedSkillIds: [],
    rankedToolNames: [],
  };
}

function toPublicMatches(matches: CatalogMatch[]): MicroRouteMatch[] {
  return matches.map((m) => ({
    id: m.entry.id,
    kind: m.entry.kind,
    score: m.score,
    label: m.entry.label,
    hint: m.entry.description.slice(0, 160),
  }));
}

function getCatalog(ctx?: MicroRouterContext): RoutableEntry[] {
  if (!ctx) return [];
  const key = catalogFingerprint(ctx.skills, ctx.tools);
  if (key === cachedCatalogKey && cachedCatalog.length > 0) {
    return cachedCatalog;
  }
  cachedCatalog = buildRoutableCatalog(ctx.skills, ctx.tools);
  cachedCatalogKey = key;
  return cachedCatalog;
}

function ruleClassify(query: string): MicroRouteResult | null {
  const text = query.trim();
  if (!text) return emptyResult(GENERAL_LANE, 'rule', 1);

  if (
    COMFYUI_RULE.test(text) ||
    COMFYUI_INTENT.test(text) ||
    COMFYUI_INTENT_REV.test(text) ||
    COMFYUI_DRAW_SIMPLE.test(text)
  ) {
    return emptyResult('comfyui', 'rule', 0.98);
  }
  if (DESIGN_UI_RULE.test(text) || DESIGN_UI_INTENT.test(text)) {
    return emptyResult('digital-products', 'rule', 0.95);
  }
  if (WEB_RESEARCH_RULE.test(text)) {
    return emptyResult('research', 'rule', 0.92);
  }
  if (GENERAL_INTENT_RULE.test(text) && !isTradingRelatedQuery(text)) {
    return emptyResult(GENERAL_LANE, 'rule', 0.92);
  }
  return null;
}

function fallbackBm25Classify(query: string, catalog: RoutableEntry[]): {
  result: MicroRouteResult;
  needsLlm: boolean;
} {
  const cfg = getMicroRouterConfig();
  const matches = rankCatalogMatches(catalog, query, cfg.maxMatches);
  if (matches.length > 0) {
    const { lane, confidence } = inferLaneFromMatches(matches, query, {
      generalLaneBias: cfg.generalLaneBias,
      specialistMinMargin: cfg.specialistMinMargin,
    });
    const { rankedSkillIds, rankedToolNames } = extractRankedIds(matches);
    const top = matches[0];
    const second = matches[1];
    const margin = (top?.score ?? 0) - (second?.score ?? 0);
    return {
      result: {
        category: lane,
        method: 'catalog',
        confidence,
        matches: toPublicMatches(matches),
        rankedSkillIds,
        rankedToolNames,
      },
      needsLlm: margin < cfg.bm25MarginThreshold,
    };
  }
  return { result: emptyResult(GENERAL_LANE, 'bm25', 0.5), needsLlm: false };
}

function catalogClassify(query: string, ctx: MicroRouterContext): { result: MicroRouteResult; needsLlm: boolean } {
  const cfg = getMicroRouterConfig();
  const catalog = getCatalog(ctx);
  const matches = rankCatalogMatches(catalog, query, cfg.maxMatches);
  const { lane, confidence } = inferLaneFromMatches(matches, query, {
    generalLaneBias: cfg.generalLaneBias,
    specialistMinMargin: cfg.specialistMinMargin,
  });
  const { rankedSkillIds, rankedToolNames } = extractRankedIds(matches);

  const top = matches[0];
  const second = matches[1];
  const margin = (top?.score ?? 0) - (second?.score ?? 0);
  const needsLlm =
    matches.length === 0 ||
    (top?.score ?? 0) < 0.08 ||
    margin < cfg.bm25MarginThreshold;

  return {
    result: {
      category: lane,
      method: 'catalog',
      confidence,
      matches: toPublicMatches(matches),
      rankedSkillIds,
      rankedToolNames,
    },
    needsLlm,
  };
}

function parseLlmLane(raw: string, allowedLanes: MicroRouteLane[]): MicroRouteLane | null {
  const normalized = slugLane(raw.replace(/^lane[:\s]*/i, ''));
  if (allowedLanes.includes(normalized)) return normalized;
  const token = normalized.split('-')[0];
  const fuzzy = allowedLanes.find((lane) => lane === normalized || lane.startsWith(token));
  return fuzzy ?? null;
}

async function llmClassify(
  query: string,
  matches: MicroRouteMatch[],
  catalog: RoutableEntry[],
): Promise<MicroRouteResult | null> {
  const cfg = getMicroRouterConfig();
  if (!cfg.useLlmFallback) return null;

  const routeConfig = resolveMicroRouterModelConfig();
  if (!routeConfig) return null;

  let releaseLocal: (() => Promise<void>) | undefined;
  try {
    if (cfg.keepAlive) {
      await warmMicroRouterModel();
    }
    if (isLocalProvider(routeConfig.provider)) {
      const { modelLoadCoordinator } = await import('../models/model-load-coordinator');
      releaseLocal = await modelLoadCoordinator.acquire(routeConfig.id);
    }

    const llm = await modelRouter.getById(routeConfig.id);
    if (!llm) return null;

    const allowedLanes = collectCatalogLanes(catalog);
    const laneLines = allowedLanes.map((lane) => `- ${lane}`).join('\n');
    const matchLines =
      matches.length > 0
        ? matches
            .slice(0, 10)
            .map((m) => `- ${m.kind}:${m.id} — ${m.hint}`)
            .join('\n')
        : '(no catalog matches)';

    const response = await llm.invoke([
      new SystemMessage(
        'You are a receptionist router. Pick EXACTLY ONE lane id from the catalog list below. ' +
          'Reply with ONLY that lane id on a single line — no punctuation, no explanation.\n\n' +
          `Available lanes (from live skills, tools, MCP):\n${laneLines}\n\n` +
          `Top catalog matches:\n${matchLines}`,
      ),
      new HumanMessage(query.slice(0, 2000)),
    ]);

    const parsed = parseLlmLane(String(response.content ?? ''), allowedLanes);
    if (!parsed) return null;
    return {
      category: parsed,
      method: 'llm',
      confidence: 0.85,
      matches,
      rankedSkillIds: matches.filter((m) => m.kind === 'skill').map((m) => m.id),
      rankedToolNames: matches.filter((m) => m.kind !== 'skill').map((m) => m.id),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[MicroRouter] LLM fallback failed: ${msg}`);
    return null;
  } finally {
    if (releaseLocal) {
      await releaseLocal();
    }
  }
}

/**
 * Classify a user query into a dynamic gateway lane from the live skill + tool + MCP catalog.
 */
export async function classifyMicroRoute(
  query: string,
  ctx?: MicroRouterContext,
): Promise<MicroRouteResult> {
  const cfg = getMicroRouterConfig();
  const trimmed = query.trim();
  if (!trimmed) {
    return emptyResult(GENERAL_LANE, 'rule', 1);
  }

  if (!cfg.enabled) {
    return emptyResult(GENERAL_LANE, 'disabled', 1);
  }

  if (isSynthesisOverProvidedData(trimmed)) {
    return emptyResult(GENERAL_LANE, 'rule', 1);
  }

  if (isCasualMessage(trimmed)) {
    return emptyResult(GENERAL_LANE, 'rule', 1);
  }

  const cacheKey = `${catalogFingerprint(ctx?.skills ?? [], ctx?.tools ?? [])}::${normalizeQuery(trimmed)}`;
  const cached = routeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const ruled = ruleClassify(trimmed);
  if (ruled) {
    if (ctx) {
      const catalogMatches = rankCatalogMatches(getCatalog(ctx), trimmed, cfg.maxMatches);
      const { rankedSkillIds, rankedToolNames } = extractRankedIds(catalogMatches);
      ruled.matches = toPublicMatches(catalogMatches);
      ruled.rankedSkillIds = rankedSkillIds;
      ruled.rankedToolNames = rankedToolNames;
    }
    routeCache.set(cacheKey, { result: ruled, expiresAt: Date.now() + cfg.cacheTtlMs });
    return ruled;
  }

  if (isTradingRelatedQuery(trimmed)) {
    let result = emptyResult('trading', 'rule', 0.9);
    if (ctx) {
      const catalogMatches = rankCatalogMatches(getCatalog(ctx), trimmed, cfg.maxMatches);
      const { rankedSkillIds, rankedToolNames } = extractRankedIds(catalogMatches);
      result = {
        ...result,
        matches: toPublicMatches(catalogMatches),
        rankedSkillIds,
        rankedToolNames,
      };
    }
    routeCache.set(cacheKey, { result, expiresAt: Date.now() + cfg.cacheTtlMs });
    return result;
  }

  const catalog = ctx ? getCatalog(ctx) : [];
  let classified: { result: MicroRouteResult; needsLlm: boolean };
  if (ctx && ctx.skills.length + ctx.tools.length > 0) {
    classified = catalogClassify(trimmed, ctx);
  } else {
    classified = fallbackBm25Classify(trimmed, catalog);
  }

  let final = classified.result;
  if (classified.needsLlm) {
    const llmResult = await llmClassify(trimmed, final.matches, catalog);
    if (llmResult) final = llmResult;
  }

  const matchSummary =
    final.matches.length > 0
      ? ` top=${final.matches
          .slice(0, 3)
          .map((m) => `${m.kind}:${m.id}`)
          .join(',')}`
      : '';
  console.log(
    `[MicroRouter] lane=${final.category} via ${final.method} (confidence ${final.confidence.toFixed(2)})${matchSummary} — "${trimmed.slice(0, 80)}"`,
  );
  routeCache.set(cacheKey, { result: final, expiresAt: Date.now() + cfg.cacheTtlMs });
  return final;
}

export { GENERAL_LANE, isGeneralLane };

/** Clear in-memory route + catalog cache (tests / toolkit reload). */
export function clearMicroRouteCache(): void {
  invalidateMicroRouterModelWarm();
  routeCache.clear();
  cachedCatalog = [];
  cachedCatalogKey = '';
}
