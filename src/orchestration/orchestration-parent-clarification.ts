import { agentRegistry } from './agent-registry';
import type { Task, TaskComment } from './types';

export const PARENT_QUESTION_PREFIX = '[Question for parent]';
export const PARENT_ANSWER_PREFIX = '[Parent answer]';
export const AWAITING_PARENT_LABEL = 'awaiting-parent';

export async function resolveParentManagerId(
  agentId: string,
  task: Task,
): Promise<string | null> {
  const agent = await agentRegistry.getById(agentId);
  if (agent?.reportsTo) {
    const manager = await agentRegistry.getById(agent.reportsTo);
    if (manager && manager.status !== 'terminated') return manager.id;
  }
  return null;
}

export async function resolveParentManagerIdWithLookup(
  agentId: string,
  task: Task,
  getTaskById: (id: string) => Promise<Task | undefined>,
): Promise<string | null> {
  const fromReports = await resolveParentManagerId(agentId, task);
  if (fromReports) return fromReports;
  if (!task.parentTaskId) return null;
  const parentTask = await getTaskById(task.parentTaskId);
  if (!parentTask) return null;
  const candidateId = parentTask.assigneeId ?? parentTask.createdBy;
  if (!candidateId || candidateId === agentId) return null;
  const candidate = await agentRegistry.getById(candidateId);
  if (candidate && candidate.status !== 'terminated') return candidate.id;
  return null;
}

export function getOpenParentQuestion(comments: TaskComment[]): string | null {
  let lastQuestion: string | null = null;
  let lastQuestionAt = 0;
  for (const comment of comments) {
    if (comment.content.startsWith(PARENT_QUESTION_PREFIX)) {
      lastQuestion = comment.content.slice(PARENT_QUESTION_PREFIX.length).trim();
      lastQuestionAt = comment.createdAt;
    }
    if (comment.content.startsWith(PARENT_ANSWER_PREFIX) && comment.createdAt >= lastQuestionAt) {
      lastQuestion = null;
    }
  }
  return lastQuestion;
}

export function isAwaitingParentAnswer(task: Task, comments: TaskComment[]): boolean {
  if (task.labels?.includes(AWAITING_PARENT_LABEL)) return true;
  return getOpenParentQuestion(comments) !== null;
}
