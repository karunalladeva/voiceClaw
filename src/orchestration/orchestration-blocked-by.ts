import type { Task } from './types';

const TASK_ID_PATTERN = /^\d{10,}-[a-z0-9]+$/i;

export function looksLikeTaskId(ref: string): boolean {
  return TASK_ID_PATTERN.test(ref.trim());
}

/** Resolve title strings in blockedBy to real task ids. */
export function normalizeBlockedByIds(blockedBy: string[], allTasks: Task[]): string[] {
  const byTitle = new Map(allTasks.map((t) => [t.title.toLowerCase(), t.id]));
  const ids = new Set<string>();
  for (const ref of blockedBy) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    if (looksLikeTaskId(trimmed)) {
      ids.add(trimmed);
      continue;
    }
    const byName = byTitle.get(trimmed.toLowerCase());
    if (byName) ids.add(byName);
  }
  return [...ids];
}
