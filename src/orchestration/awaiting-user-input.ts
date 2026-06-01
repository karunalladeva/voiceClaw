import type { Task } from './types';

export const AWAITING_USER_LABEL = 'awaiting-user';

const OUTPUT_WAIT_PATTERNS: RegExp[] = [
  /waiting for your (selection|choice|input|response|approval|decision)/i,
  /paused[\s\-–—]*waiting/i,
  /please select (one|a|your|from)/i,
  /which .{0,120}\?/i,
  /wait(ing)? for (my|user|human|your) explicit/i,
  /awaiting your (selection|approval|input|response|decision)/i,
  /stopped all task delegation/i,
  /do not proceed until (you|the user|I)/i,
];

export function detectAwaitingUserInput(output: string, task?: Task): boolean {
  const trimmed = output?.trim() ?? '';
  if (trimmed.length < 80) return false;
  // Skill handoff only — manager did not write its own pause message; do not pause pipeline.
  if (
    trimmed.includes('[Sub-Agent Result from') &&
    !/STOPPED ALL TASK DELEGATION|PAUSED\s*[-–—]*\s*waiting/i.test(trimmed)
  ) {
    return false;
  }
  if (OUTPUT_WAIT_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  const desc = task?.description ?? '';
  if (/stop and ask/i.test(desc) && trimmed.includes('?')) return true;
  if (/wait for my explicit selection/i.test(desc) && trimmed.includes('?')) return true;
  return false;
}

export function extractUserClarificationQuestion(output: string, task?: Task): string {
  const trimmed = output.trim();
  const pausedSection = trimmed.match(
    /(?:PAUSED|WAITING FOR YOUR)[\s\S]*?(?:Which[^?]+\?|Please[^?]+\?|Select[^?]+\?)/i,
  );
  if (pausedSection) return pausedSection[0].trim().slice(0, 4000);
  const questions = trimmed.match(/[^\n?]{10,200}\?/g);
  if (questions?.length) return questions[questions.length - 1].trim();
  if (task?.description && /stop and ask/i.test(task.description)) {
    return 'Please review the agent output and provide your selection or approval to continue.';
  }
  return trimmed.slice(0, 2000);
}

export function hasAwaitingUserLabel(labels: string[] | undefined): boolean {
  return labels?.includes(AWAITING_USER_LABEL) ?? false;
}
