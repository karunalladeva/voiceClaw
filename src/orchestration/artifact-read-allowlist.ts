import * as path from 'path';
import {
  getRootArtifactAbsDir,
  getRootArtifactRelDir,
  getTaskArtifactAbsDir,
  getTaskArtifactRelDir,
  listTaskArtifactRelPaths,
  type TaskArtifactScope,
} from './task-artifacts';
import {
  loadPipelineWorkflow,
  pipelineWorkflowAbsPath,
  resolveManagerTaskIdForRoot,
} from './pipeline-workflow';
import type { PipelineWorkflow } from './pipeline-workflow-schema';
import type { Task } from './types';

const TOOL_TRACE_DIRS = new Set(['read_file', 'list_files', 'write_file']);

export type ReadAllowlistResult = {
  absPaths: string[];
  relPaths: string[];
  descriptions: string[];
};

function normAbs(p: string): string {
  return path.resolve(p).replace(/\\/g, '/');
}

function isUnderDir(fileAbs: string, dirAbs: string): boolean {
  const f = normAbs(fileAbs);
  const d = normAbs(dirAbs);
  return f === d || f.startsWith(d + '/');
}

export async function buildWorkerReadAllowlist(
  task: Task,
  allTasks: Task[],
  workflow: PipelineWorkflow | null,
  options?: { isManager?: boolean },
): Promise<ReadAllowlistResult> {
  const rootId = task.rootTaskId ?? task.id;
  const scope: TaskArtifactScope = { id: task.id, rootTaskId: rootId };
  const ownAbs = getTaskArtifactAbsDir(scope);
  const ownRel = getTaskArtifactRelDir(scope);
  const absPaths: string[] = [ownAbs];
  const relPaths: string[] = [`${ownRel}/`];
  const descriptions: string[] = [`Your artifact folder: ${ownRel}/`];

  const managerTaskId =
    (await resolveManagerTaskIdForRoot(rootId, allTasks)) ??
    (options?.isManager ? task.id : null);

  if (managerTaskId) {
    const wfAbs = pipelineWorkflowAbsPath({ id: managerTaskId, rootTaskId: rootId });
    const wfRel = `${getTaskArtifactRelDir({ id: managerTaskId, rootTaskId: rootId })}/pipeline/workflow.json`;
    absPaths.push(wfAbs);
    relPaths.push(wfRel);
    descriptions.push(`Pipeline contract: ${wfRel}`);
  }

  const taskById = new Map(allTasks.map((t) => [t.id, t]));

  for (const blockerId of task.blockedBy ?? []) {
    const blocker = taskById.get(blockerId);
    if (!blocker || blocker.status !== 'done') continue;
    const blockerScope = { id: blocker.id, rootTaskId: rootId };
    const blockerAbs = getTaskArtifactAbsDir(blockerScope);
    const blockerRel = getTaskArtifactRelDir(blockerScope);
    absPaths.push(blockerAbs);
    relPaths.push(`${blockerRel}/`);
    descriptions.push(`Completed blocker "${blocker.title}": ${blockerRel}/`);
  }

  if (workflow) {
    const phase =
      workflow.phases.find((p) => p.title.toLowerCase() === task.title.trim().toLowerCase()) ??
      workflow.phases.find((p) => p.id === task.title.trim().toLowerCase());
    for (const phaseId of phase?.readsFrom ?? []) {
      const wfPhase = workflow.phases.find((p) => p.id === phaseId);
      if (!wfPhase) continue;
      const matchTask = allTasks.find(
        (t) =>
          (t.rootTaskId ?? t.id) === rootId &&
          (t.title.toLowerCase() === wfPhase.title.toLowerCase() || t.title.toLowerCase() === phaseId),
      );
      if (!matchTask || matchTask.status !== 'done') continue;
      const ms = { id: matchTask.id, rootTaskId: rootId };
      const mAbs = getTaskArtifactAbsDir(ms);
      const mRel = getTaskArtifactRelDir(ms);
      if (!absPaths.some((p) => normAbs(p) === normAbs(mAbs))) {
        absPaths.push(mAbs);
        relPaths.push(`${mRel}/`);
        descriptions.push(`Workflow readsFrom "${phaseId}": ${mRel}/`);
      }
    }
  }

  if (options?.isManager) {
    const rootAbs = getRootArtifactAbsDir(rootId);
    absPaths.push(rootAbs);
    relPaths.push(`${getRootArtifactRelDir(rootId)}/`);
    descriptions.push(`Manager monitor: all artifacts under ${getRootArtifactRelDir(rootId)}/`);
  }

  return { absPaths, relPaths, descriptions };
}

export function isReadPathAllowed(resolvedAbs: string, allowlist: ReadAllowlistResult): boolean {
  const target = normAbs(resolvedAbs);
  for (const allowed of allowlist.absPaths) {
    if (isUnderDir(target, allowed) || normAbs(allowed) === target) {
      const rel = path.relative(allowed, target).replace(/\\/g, '/');
      const top = rel.split('/')[0];
      if (TOOL_TRACE_DIRS.has(top)) return false;
      return true;
    }
  }
  return false;
}

export async function listUpstreamDeliverablePaths(
  allowlist: ReadAllowlistResult,
  ownTaskRelDir: string,
): Promise<string[]> {
  const out: string[] = [];
  const prefix = `${ownTaskRelDir}/`;
  for (const relPrefix of allowlist.relPaths) {
    if (relPrefix === `${ownTaskRelDir}/` || relPrefix.startsWith(prefix)) continue;
    if (relPrefix.endsWith('workflow.json')) {
      out.push(relPrefix);
      continue;
    }
    const folderRel = relPrefix.replace(/\/$/, '');
    const parts = folderRel.split('/');
    const taskId = parts[parts.length - 1];
    const rootId = parts[parts.length - 2];
    if (!taskId || !rootId) continue;
    try {
      const paths = await listTaskArtifactRelPaths({ id: taskId, rootTaskId: rootId });
      for (const p of paths) {
        if (!p.startsWith(prefix) && !TOOL_TRACE_DIRS.has(p.split('/').pop() ?? '')) {
          out.push(p);
        }
      }
    } catch {
      /* skip */
    }
  }
  return out.slice(0, 80);
}
