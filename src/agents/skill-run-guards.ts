/**
 * Generic skill-run completion checks for orchestration (no skill-id or domain logic).
 */

import { detectAwaitingUserInput } from '../orchestration/awaiting-user-input';
import type { Task } from '../orchestration/types';
import { STRUCTURED_OUTPUT_MARKER } from './skill-structured-output';
import {
  ORCHESTRATOR_TOOL_APPENDIX_HEADER,
  SKILL_RUN_INCOMPLETE_MARKER,
  stripOrchestratorToolAppendix,
} from './skill-handoff';

export const STRUCTURED_OUTPUT_INVALID_MARKER = `${STRUCTURED_OUTPUT_MARKER} INVALID`;

const INCOMPLETE_WORK_APPENDIX_MAX_CHARS = 8000;
const MIN_MANAGER_NARRATIVE_CHARS = 400;

export function isSkillHandoffIncomplete(handoff: string): boolean {
  return (
    handoff.includes(SKILL_RUN_INCOMPLETE_MARKER) ||
    handoff.includes(STRUCTURED_OUTPUT_INVALID_MARKER)
  );
}

export function hasValidStructuredOutputHandoff(handoff: string): boolean {
  return (
    handoff.includes(STRUCTURED_OUTPUT_MARKER) &&
    !handoff.includes(STRUCTURED_OUTPUT_INVALID_MARKER)
  );
}

/** Preserve narrative plus truncated tool traces for incomplete runs. */
export function formatIncompleteWorkProduct(handoff: string): string {
  const appendixIdx = handoff.indexOf(ORCHESTRATOR_TOOL_APPENDIX_HEADER);
  const narrative = stripOrchestratorToolAppendix(handoff).trim();
  if (appendixIdx === -1) {
    return narrative || handoff.trim();
  }
  let appendix = handoff.slice(appendixIdx).trim();
  if (appendix.length > INCOMPLETE_WORK_APPENDIX_MAX_CHARS) {
    const slice = appendix.slice(0, INCOMPLETE_WORK_APPENDIX_MAX_CHARS);
    const lastBreak = slice.lastIndexOf('\n');
    appendix =
      (lastBreak > INCOMPLETE_WORK_APPENDIX_MAX_CHARS * 0.5
        ? slice.slice(0, lastBreak)
        : slice) + '\n...[artifact appendix truncated]...';
  }
  if (narrative.length >= 80) {
    return `${narrative}\n\n${appendix}`;
  }
  return appendix;
}

/** Whether a manager may delegate after prior incomplete skill comments on the task. */
export function canDelegateWithPriorIncompleteRuns(output: string, task: Task | null): boolean {
  if (hasValidStructuredOutputHandoff(output)) return true;
  if (task && detectAwaitingUserInput(output, task)) return true;

  const narrative = stripOrchestratorToolAppendix(output)
    .replace(/\[SKILL_RUN_INCOMPLETE\][^\n]*\n?/gi, '')
    .replace(/\[Sub-Agent Result from[^\]]+\]:/gi, '')
    .replace(new RegExp(`${STRUCTURED_OUTPUT_MARKER}[\\s\\S]*$`), '')
    .trim();

  return narrative.length >= MIN_MANAGER_NARRATIVE_CHARS;
}
