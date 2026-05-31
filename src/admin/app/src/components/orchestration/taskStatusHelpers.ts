import { PIPELINE_MODE_LABEL } from '@/types/orchestration';
import type { Task } from '@/types/orchestration';

export const AWAITING_USER_LABEL = 'awaiting-user';
export const AWAITING_PARENT_LABEL = 'awaiting-parent';

export function getTaskStatusHints(task: Task): string[] {
  const hints: string[] = [];
  if (task.status === 'blocked') hints.push('Awaiting human approval');
  if (task.labels?.includes(AWAITING_USER_LABEL)) hints.push('Waiting for your answer');
  if (task.labels?.includes(AWAITING_PARENT_LABEL)) hints.push('Waiting for parent manager');
  if (task.status === 'review') hints.push('Awaiting review');
  if ((task.blockedBy?.length ?? 0) > 0 && task.status !== 'done') {
    hints.push(`Blocked by ${task.blockedBy!.length} task(s)`);
  }
  return hints;
}

export function isPipelineTask(task: Task): boolean {
  return task.labels?.includes(PIPELINE_MODE_LABEL) ?? false;
}

export function getRootTaskId(task: Task): string {
  return task.rootTaskId ?? task.id;
}
