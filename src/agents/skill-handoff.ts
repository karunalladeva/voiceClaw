/**
 * Skill → orchestrator handoff formatting (shared by agent-factory and react-agent).
 */

import { getAgentRunContext } from './agent-run-context';
import { packMarkdownToCharBudget } from '../utils/query-aware-truncate';
import { truncateToolOutput } from '../utils/tool-output-truncate';

export const SKILL_RUN_INCOMPLETE_MARKER = '[SKILL_RUN_INCOMPLETE]';

export const ORCHESTRATOR_TOOL_APPENDIX_HEADER =
  '--- Orchestrator tool trace (delegation only; not for end-user reports) ---';

export const SKILL_INCOMPLETE_COMMENT_PREFIX = '[SKILL_INCOMPLETE skillId=';

export type SkillToolTrace = { name: string; output: string };

const SKILL_TOOL_APPENDIX_MAX_CHARS = 6000;

/** Max chars returned to orchestrator via route_to_skill (full artifact may be in task store). */
export const ORCHESTRATOR_HANDOFF_MAX_CHARS = 12_000;

const HANDOFF_TRUNCATION_NOTE =
  '\n\n...[Handoff truncated for orchestrator context (BM25-ranked vs task query when available) — full output in task work product]...';

function resolveHandoffRankingQuery(explicitQuery?: string): string {
  const explicit = explicitQuery?.trim();
  if (explicit) return explicit;
  const ctx = getAgentRunContext();
  return ctx?.lastWebSearchQuery?.trim() || ctx?.lastUserQuery?.trim() || '';
}

function capHandoffSection(text: string, query: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const packed = packMarkdownToCharBudget(text, query, Math.max(400, maxChars - 80));
  if (packed.length <= maxChars) return packed;
  return truncateToolOutput(packed, maxChars);
}

/** Cap skill → orchestrator handoff; keeps incomplete markers and ranks body via BM25 when over budget. */
export function capOrchestratorHandoff(handoff: string, query?: string): string {
  if (handoff.length <= ORCHESTRATOR_HANDOFF_MAX_CHARS) return handoff;

  const rankingQuery = resolveHandoffRankingQuery(query);
  let prefix = '';
  let body = handoff;
  if (handoff.startsWith(SKILL_RUN_INCOMPLETE_MARKER)) {
    const splitAt = handoff.indexOf('\n\n');
    if (splitAt > 0) {
      prefix = handoff.slice(0, splitAt + 2);
      body = handoff.slice(splitAt + 2);
    }
  }

  const appendixIdx = body.indexOf(ORCHESTRATOR_TOOL_APPENDIX_HEADER);
  let narrative = body;
  let appendix = '';
  if (appendixIdx >= 0) {
    narrative = body.slice(0, appendixIdx).trimEnd();
    appendix = body.slice(appendixIdx).trim();
  }

  const noteLen = HANDOFF_TRUNCATION_NOTE.length;
  const budget = ORCHESTRATOR_HANDOFF_MAX_CHARS - prefix.length - noteLen;
  if (budget <= 600) {
    return truncateToolOutput(handoff, ORCHESTRATOR_HANDOFF_MAX_CHARS);
  }

  if (!appendix) {
    return prefix + capHandoffSection(narrative, rankingQuery, budget) + HANDOFF_TRUNCATION_NOTE;
  }

  const narrativeBudget = Math.floor(budget * 0.55);
  const appendixBudget = budget - narrativeBudget;
  const cappedNarrative = capHandoffSection(narrative, rankingQuery, narrativeBudget);
  const cappedAppendix = capHandoffSection(appendix, rankingQuery, appendixBudget);
  return prefix + cappedNarrative + '\n\n' + cappedAppendix + HANDOFF_TRUNCATION_NOTE;
}

export function extractToolOutputFromEvent(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const output = (data as { output?: unknown }).output;
  if (typeof output === 'string') return output;
  if (output == null) return '';
  if (typeof output === 'object' && 'content' in (output as object)) {
    const content = (output as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((block: { text?: string }) => block?.text ?? '').join('');
    }
  }
  return String(output);
}

export function formatSkillIncompleteMarker(skillId: string): string {
  return `${SKILL_RUN_INCOMPLETE_MARKER} skillId=${skillId}`;
}

export function parseIncompleteSkillId(handoff: string): string | null {
  const m = handoff.match(/\[SKILL_RUN_INCOMPLETE\]\s*skillId=([a-z0-9-]+)/i);
  return m?.[1] ?? null;
}

export function stripOrchestratorToolAppendix(handoff: string): string {
  const idx = handoff.indexOf(ORCHESTRATOR_TOOL_APPENDIX_HEADER);
  if (idx === -1) return handoff.trim();
  return handoff.slice(0, idx).trim();
}

export function composeSkillHandoff(
  assistantText: string,
  toolTraces: SkillToolTrace[],
  incomplete: boolean,
  skillId: string,
  taskQuery?: string,
): string {
  const text = assistantText.trim();
  let body = text;

  if (toolTraces.length > 0) {
    const appendix = toolTraces
      .map(
        (trace, index) =>
          `### ${index + 1}. ${trace.name}\n${truncateToolOutput(trace.output, SKILL_TOOL_APPENDIX_MAX_CHARS)}`,
      )
      .join('\n\n');
    if (text.length >= 80) {
      body = `${text}\n\n${ORCHESTRATOR_TOOL_APPENDIX_HEADER}\n${appendix}`;
    } else {
      body = `${ORCHESTRATOR_TOOL_APPENDIX_HEADER}\n${appendix}`;
    }
  }

  const capped = capOrchestratorHandoff(body, taskQuery);
  if (!incomplete) return capped;
  return `${formatSkillIncompleteMarker(skillId)} Skill stopped early (tool limit or timeout) — orchestrator must NOT re-run this skill on the same task; use partial data from the tool trace, a fallback skill once, or delegate the next phase.\n\n${capped}`;
}

export function buildSkillResumeGuidance(blockedSkillIds: string[]): string {
  if (blockedSkillIds.length === 0) return '';
  const ids = blockedSkillIds.map((id) => `"${id}"`).join(', ');
  return (
    `\n--- VALIDATION RESUME ---\n` +
    `Prior skill run(s) ended incomplete for: ${ids}.\n` +
    `Do NOT call route_to_skill again with the same skill id on this task.\n` +
    `Options: (1) use partial output below and create_subtask for the next phase, (2) route_to_skill once with a different allowed fallback skill, (3) ask the user for clarification or a direct source URL.\n` +
    `Label any unverified rows UNVALIDATED.`
  );
}

export function parseBlockedSkillIdsFromComments(
  comments: Array<{ content: string }>,
): string[] {
  const ids = new Set<string>();
  for (const c of comments) {
    const m = c.content.match(/\[SKILL_INCOMPLETE skillId=([a-z0-9-]+)\]/gi);
    if (!m) continue;
    for (const tag of m) {
      const id = tag.match(/skillId=([a-z0-9-]+)/i)?.[1];
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
