import { hasPipelineModeLabel } from './orchestration-labels';
import type { Task } from './types';

const TERMINAL = new Set(['done', 'cancelled']);

export async function isRootPipelineMode(
  task: Task,
  loadRoot: (rootId: string) => Promise<Task>,
): Promise<boolean> {
  const rootId = task.rootTaskId ?? task.id;
  const root = rootId === task.id ? task : await loadRoot(rootId);
  return hasPipelineModeLabel(root.labels);
}

export function hasOpenSubtasks(parent: Task, subtasks: Task[]): boolean {
  return subtasks.some(
    (s) => s.parentTaskId === parent.id && !TERMINAL.has(s.status),
  );
}

/** Pipeline-mode parent waiting on active delegated subtasks — block worker checkout. */
export function isPipelineCoordinatorAwaitingSubtasks(
  task: Task,
  subtasks: Task[],
  rootIsPipeline: boolean,
): boolean {
  if (!rootIsPipeline) return false;
  if (!subtasks.some((s) => s.parentTaskId === task.id)) return false;
  if (!(task.blockedBy?.length ?? 0)) return false;
  if (!hasOpenSubtasks(task, subtasks)) return false;
  const openBlockerIds = (task.blockedBy ?? []).filter((id) => {
    const sub = subtasks.find((s) => s.id === id);
    return sub && !TERMINAL.has(sub.status);
  });
  return openBlockerIds.length > 0 || hasOpenSubtasks(task, subtasks);
}

export function normalizeTitleForMatch(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function titlesOverlap(a: string, b: string): boolean {
  const na = normalizeTitleForMatch(a);
  const nb = normalizeTitleForMatch(b);
  if (na === nb) return true;
  if (na.length >= 8 && nb.length >= 8 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}
