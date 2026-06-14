import * as fs from 'fs/promises';
import * as path from 'path';
import {
  defaultPipelineWorkflow,
  pipelineWorkflowSchema,
  type PipelineWorkflow,
} from './pipeline-workflow-schema';
import {
  getTaskArtifactAbsDir,
  getTaskArtifactRelDir,
  type TaskArtifactScope,
} from './task-artifacts';
import type { Task } from './types';

export const PIPELINE_WORKFLOW_REL = 'pipeline/workflow.json';
export const PIPELINE_USER_DECISION_REL = 'pipeline/user-decision.json';

export function pipelineWorkflowAbsPath(scope: TaskArtifactScope): string {
  return path.join(getTaskArtifactAbsDir(scope), 'pipeline', 'workflow.json');
}

export function pipelineUserDecisionAbsPath(scope: TaskArtifactScope): string {
  return path.join(getTaskArtifactAbsDir(scope), 'pipeline', 'user-decision.json');
}

export function pipelineWorkflowRelPath(scope: TaskArtifactScope): string {
  return `${getTaskArtifactRelDir(scope)}/${PIPELINE_WORKFLOW_REL}`;
}

export async function loadPipelineWorkflow(scope: TaskArtifactScope): Promise<PipelineWorkflow | null> {
  try {
    const raw = await fs.readFile(pipelineWorkflowAbsPath(scope), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const result = pipelineWorkflowSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function savePipelineWorkflow(
  scope: TaskArtifactScope,
  workflow: PipelineWorkflow,
): Promise<string> {
  const dir = path.dirname(pipelineWorkflowAbsPath(scope));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(pipelineWorkflowAbsPath(scope), JSON.stringify(workflow, null, 2), 'utf-8');
  return pipelineWorkflowRelPath(scope);
}

export async function ensureDefaultPipelineWorkflow(
  scope: TaskArtifactScope,
  updatedBy?: string,
): Promise<PipelineWorkflow> {
  const existing = await loadPipelineWorkflow(scope);
  if (existing) return existing;
  const workflow = defaultPipelineWorkflow(updatedBy);
  await savePipelineWorkflow(scope, workflow);
  return workflow;
}

export type UserDecisionRecord = {
  decision: string;
  approvedAt: number;
  source: 'clarification' | 'manual';
};

export async function loadUserDecision(scope: TaskArtifactScope): Promise<UserDecisionRecord | null> {
  try {
    const raw = await fs.readFile(pipelineUserDecisionAbsPath(scope), 'utf-8');
    return JSON.parse(raw) as UserDecisionRecord;
  } catch {
    return null;
  }
}

export async function saveUserDecision(
  scope: TaskArtifactScope,
  record: UserDecisionRecord,
): Promise<void> {
  const dir = path.dirname(pipelineUserDecisionAbsPath(scope));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(pipelineUserDecisionAbsPath(scope), JSON.stringify(record, null, 2), 'utf-8');
}

/** Resolve manager task id for a root — first parent task with pipeline/workflow.json or root itself. */
export async function resolveManagerTaskIdForRoot(
  rootTaskId: string,
  tasks: Task[],
): Promise<string | null> {
  const rootScope = { id: rootTaskId, rootTaskId };
  if (await loadPipelineWorkflow(rootScope)) return rootTaskId;

  const subtasks = tasks.filter((t) => (t.rootTaskId ?? t.id) === rootTaskId);
  for (const t of subtasks) {
    const scope = { id: t.id, rootTaskId: rootTaskId };
    if (await loadPipelineWorkflow(scope)) return t.id;
  }
  return null;
}

export function phaseForTaskTitle(workflow: PipelineWorkflow, title: string): PipelineWorkflow['phases'][0] | null {
  const norm = title.trim().toLowerCase();
  return (
    workflow.phases.find((p) => p.title.toLowerCase() === norm || p.id === norm) ?? null
  );
}

export function formatWorkflowExcerpt(workflow: PipelineWorkflow, maxPhases = 6): string {
  const lines = workflow.phases.slice(0, maxPhases).map((p, i) => {
    const deps = p.blockedAfter ? ` (after: ${p.blockedAfter})` : '';
    const reads = p.readsFrom?.length ? ` reads: ${p.readsFrom.join(', ')}` : '';
    return `${i + 1}. ${p.title}${deps}${reads}`;
  });
  return `Pipeline workflow v${workflow.version}:\n${lines.join('\n')}`;
}
