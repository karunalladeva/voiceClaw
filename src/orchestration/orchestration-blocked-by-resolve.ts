import { normalizeTitleForMatch, titlesOverlap } from './pipeline-helpers';
import { looksLikeTaskId } from './orchestration-blocked-by';
import type { Task } from './types';

export interface BlockedByResolveContext {
  parentTask: Task;
  createdByTitle: Map<string, string>;
  createdByPhaseId: Map<string, string>;
  existingSubtasks: Task[];
  lastCreatedId?: string;
}

export interface BlockedByResolveResult {
  resolved: string[];
  unresolved: string[];
}

function findTaskIdByTitleRef(
  ref: string,
  createdByTitle: Map<string, string>,
  existingSubtasks: Task[],
): string | undefined {
  const normalized = normalizeTitleForMatch(ref);
  const direct = createdByTitle.get(normalized);
  if (direct) return direct;
  for (const [titleKey, id] of createdByTitle) {
    if (titlesOverlap(titleKey, ref)) return id;
  }
  const existing = existingSubtasks.find((t) => titlesOverlap(t.title, ref));
  return existing?.id;
}

function getMostRecentSiblingId(subtasks: Task[]): string | undefined {
  if (subtasks.length === 0) return undefined;
  const sorted = [...subtasks].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return sorted[0]?.id;
}

export function resolveBlockedByRefs(
  refs: string[] | undefined,
  context: BlockedByResolveContext,
): BlockedByResolveResult {
  const {
    parentTask,
    createdByTitle,
    createdByPhaseId,
    existingSubtasks,
    lastCreatedId,
  } = context;
  if (!refs?.length) {
    if (lastCreatedId) {
      return { resolved: [lastCreatedId], unresolved: [] };
    }
    return { resolved: [], unresolved: [] };
  }
  const resolved: string[] = [];
  const unresolved: string[] = [];
  for (const ref of refs) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    if (trimmed === 'parent' || trimmed === parentTask.id) {
      resolved.push(parentTask.id);
      continue;
    }
    if (trimmed === 'previous') {
      const prevId = lastCreatedId ?? getMostRecentSiblingId(existingSubtasks);
      if (prevId) {
        resolved.push(prevId);
      } else {
        unresolved.push(trimmed);
      }
      continue;
    }
    const byPhase =
      createdByPhaseId.get(trimmed.toLowerCase()) ??
      createdByPhaseId.get(normalizeTitleForMatch(trimmed));
    if (byPhase) {
      resolved.push(byPhase);
      continue;
    }
    const byTitle = findTaskIdByTitleRef(trimmed, createdByTitle, existingSubtasks);
    if (byTitle) {
      resolved.push(byTitle);
      continue;
    }
    if (looksLikeTaskId(trimmed)) {
      const exists = existingSubtasks.some((t) => t.id === trimmed) || trimmed === parentTask.id;
      if (exists) {
        resolved.push(trimmed);
      } else {
        unresolved.push(trimmed);
      }
      continue;
    }
    unresolved.push(trimmed);
  }
  const uniqueResolved = resolved.length > 0 ? [...new Set(resolved)] : [];
  return { resolved: uniqueResolved, unresolved };
}
