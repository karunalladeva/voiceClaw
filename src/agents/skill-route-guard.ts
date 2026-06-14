import { getAgentRunContext } from './agent-run-context';
import {
  buildSkillResumeGuidance,
  formatSkillIncompleteMarker,
  parseBlockedSkillIdsFromComments,
  SKILL_RUN_INCOMPLETE_MARKER,
} from './skill-handoff';
import { taskManager } from '../orchestration/task-manager';
import { taskWorkflow } from '../orchestration/task-workflow';
import { loadUserDecision } from '../orchestration/pipeline-workflow';
import { toTaskArtifactScope } from './agent-run-context';

const RESEARCH_FALLBACK_SKILL_IDS = new Set([
  'digital-product-research-fallback',
  'ebook-validation-engine',
  'etsy-gumroad-niche-validator',
  'digital-product-competitor-breakdown',
]);

export async function resolveBlockedSkillIdsForRun(): Promise<Set<string>> {
  const blocked = new Set<string>();
  const runCtx = getAgentRunContext();
  if (runCtx?.blockedSkillIds) {
    for (const id of runCtx.blockedSkillIds) blocked.add(id);
  }
  if (runCtx?.orgTaskId) {
    try {
      const comments = await taskManager.getComments(runCtx.orgTaskId);
      for (const id of parseBlockedSkillIdsFromComments(comments)) blocked.add(id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[skill-route-guard] Could not load task comments: ${msg}`);
    }
  }
  return blocked;
}

export async function resolveSkillRouteDenial(skillId: string): Promise<string | null> {
  const runCtx = getAgentRunContext();
  if (!runCtx?.orgTaskId) return null;

  if (runCtx.blockersOpen) {
    return (
      `route_to_skill blocked: task has open dependencies. ` +
      `Wait for blockers to complete before running "${skillId}". ` +
      `Use read_file / list_files on allowed upstream paths only.`
    );
  }

  if (runCtx.userDecisionBound && RESEARCH_FALLBACK_SKILL_IDS.has(skillId)) {
    return (
      `route_to_skill blocked: user decision is binding — do not re-run research fallback "${skillId}". ` +
      `Proceed to the next workflow phase (create_subtask) per workflow.json.`
    );
  }

  if (runCtx.userDecisionBound === undefined && runCtx.orgTaskId) {
    try {
      const decision = await loadUserDecision(toTaskArtifactScope(runCtx));
      if (decision && RESEARCH_FALLBACK_SKILL_IDS.has(skillId)) {
        return (
          `route_to_skill blocked: user already chose "${decision.decision.slice(0, 120)}". ` +
          `Do not use research fallback "${skillId}" again.`
        );
      }
    } catch {
      /* skip */
    }
  }

  if (runCtx.isManagerRun && runCtx.pipelineMode) {
    const task = await taskManager.getTaskById(runCtx.orgTaskId);
    if (task) {
      const { loadPipelineWorkflow } = await import('../orchestration/pipeline-workflow');
      const workflow = await loadPipelineWorkflow(toTaskArtifactScope(runCtx));
      if (!workflow && skillId !== 'file-manager') {
        const { configManager } = await import('../config/index');
        if (configManager.getConfig().agent.requirePipelineWorkflow !== false) {
          return (
            `route_to_skill blocked: write pipeline/workflow.json before running skills or delegating.`
          );
        }
      }
    }
  }

  return null;
}

export function registerBlockedSkill(skillId: string): void {
  const runCtx = getAgentRunContext();
  if (!runCtx) return;
  if (!runCtx.blockedSkillIds) runCtx.blockedSkillIds = new Set();
  runCtx.blockedSkillIds.add(skillId);
  console.log(`[skill-route-guard] Blocked skill retry on this run: ${skillId}`);
}

export function buildBlockedSkillRouteResult(skillName: string, skillId: string): string {
  return (
    `[Sub-Agent Result from ${skillName}]:\n` +
    `${formatSkillIncompleteMarker(skillId)} ` +
    `Blocked: "${skillId}" already ran incomplete on this task. ` +
    `Do not call route_to_skill with this skill id again. ` +
    `Use a fallback skill once or create_subtask with partial data.\n\n` +
    buildSkillResumeGuidance([skillId]).trim()
  );
}

export function buildDeniedSkillRouteResult(skillName: string, skillId: string, reason: string): string {
  return `[Sub-Agent Result from ${skillName}]:\nBlocked: "${skillId}" — ${reason}`;
}

export function isSkillRouteBlockedMessage(output: string): boolean {
  return (
    output.includes(SKILL_RUN_INCOMPLETE_MARKER) &&
    /Blocked:\s*"/i.test(output)
  );
}

export async function checkTaskBlockersForRun(): Promise<boolean> {
  const runCtx = getAgentRunContext();
  if (!runCtx?.orgTaskId) return false;
  if (runCtx.blockersOpen !== undefined) return runCtx.blockersOpen;
  const task = await taskManager.getTaskById(runCtx.orgTaskId);
  if (!task) return false;
  return !(await taskWorkflow.areBlockersSatisfied(task));
}
