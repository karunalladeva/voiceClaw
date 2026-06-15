import { normalizeTitleForMatch, titlesOverlap } from './pipeline-helpers';
import type { Task } from './types';

const TASK_ID_PATTERN = /^\d{10,}-[a-z0-9]+$/i;

export function looksLikeTaskId(ref: string): boolean {
  return TASK_ID_PATTERN.test(ref.trim());
}

function findTaskIdByRef(ref: string, allTasks: Task[]): string | undefined {
  const trimmed = ref.trim();
  if (!trimmed) return undefined;
  const byId = allTasks.find((t) => t.id === trimmed);
  if (byId) return byId.id;
  const normalized = normalizeTitleForMatch(trimmed);
  const exact = allTasks.find((t) => normalizeTitleForMatch(t.title) === normalized);
  if (exact) return exact.id;
  const fuzzy = allTasks.find((t) => titlesOverlap(t.title, trimmed));
  return fuzzy?.id;
}

/** Resolve title strings in blockedBy to real task ids (drops unknown/missing refs). */
export function normalizeBlockedByIds(blockedBy: string[], allTasks: Task[]): string[] {
  const ids = new Set<string>();
  for (const ref of blockedBy) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    if (looksLikeTaskId(trimmed)) {
      if (allTasks.some((t) => t.id === trimmed)) ids.add(trimmed);
      continue;
    }
    const match = findTaskIdByRef(trimmed, allTasks);
    if (match) ids.add(match);
  }
  return [...ids];
}

/** Remove blocker ids that no longer exist in the task store. */
export function pruneStaleBlockedByIds(blockedBy: string[] | undefined, allTasks: Task[]): string[] {
  if (!blockedBy?.length) return [];
  const taskIds = new Set(allTasks.map((t) => t.id));
  return blockedBy.filter((id) => taskIds.has(id));
}
