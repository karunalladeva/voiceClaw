import type { Task, TaskSource } from './types';

export function normalizeTask(task: Task): Task {
  const source: TaskSource = task.source ?? 'user';
  const rootTaskId = task.rootTaskId ?? (source === 'user' ? task.id : task.rootTaskId);
  return {
    ...task,
    source,
    rootTaskId: rootTaskId || task.id,
    blockedBy: task.blockedBy ?? [],
    reworkCount: task.reworkCount ?? 0,
  };
}

export function normalizeTasks(tasks: Task[]): Task[] {
  return tasks.map(normalizeTask);
}

export function isAgentCreatedBy(createdBy: string, agentIds: Set<string>): boolean {
  return agentIds.has(createdBy);
}
