import { getAgentRunContext } from './agent-run-context';
import {
  buildSkillResumeGuidance,
  formatSkillIncompleteMarker,
  parseBlockedSkillIdsFromComments,
  SKILL_RUN_INCOMPLETE_MARKER,
} from './skill-handoff';
import { taskManager } from '../orchestration/task-manager';

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

export function isSkillRouteBlockedMessage(output: string): boolean {
  return (
    output.includes(SKILL_RUN_INCOMPLETE_MARKER) &&
    /Blocked:\s*"/i.test(output)
  );
}
