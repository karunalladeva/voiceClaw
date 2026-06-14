import { configManager } from '../config/index';
import { buildWorkerReadAllowlist, listUpstreamDeliverablePaths } from './artifact-read-allowlist';
import { hasPipelineModeLabel } from './orchestration-labels';
import {
  formatWorkflowExcerpt,
  loadPipelineWorkflow,
  loadUserDecision,
  type UserDecisionRecord,
} from './pipeline-workflow';
import type { PipelineWorkflow } from './pipeline-workflow-schema';
import { orchestrationStore } from './store';
import { taskWorkflow } from './task-workflow';
import type { OrgAgent, Task } from './types';
import type { ReadAllowlistResult } from './artifact-read-allowlist';
import { agentRegistry } from './agent-registry';

export type OrchestrationRunPrep = {
  pipelineMode: boolean;
  isManager: boolean;
  allowedReadPaths?: ReadAllowlistResult;
  workflow: PipelineWorkflow | null;
  userDecision: UserDecisionRecord | null;
  blockersOpen: boolean;
  openBlockerTitles: string[];
  enforceArtifactIo: boolean;
  requireWorkflowBeforeDelegate: boolean;
};

export async function prepareOrchestrationRunPrep(
  agent: OrgAgent,
  task: Task | null,
): Promise<OrchestrationRunPrep> {
  const cfg = configManager.getConfig();
  if (!task) {
    return {
      pipelineMode: false,
      isManager: false,
      workflow: null,
      userDecision: null,
      blockersOpen: false,
      openBlockerTitles: [],
      enforceArtifactIo: false,
      requireWorkflowBeforeDelegate: false,
    };
  }

  const rootId = task.rootTaskId ?? task.id;
  const root =
    task.rootTaskId && task.rootTaskId !== task.id
      ? await taskManagerSafeGet(rootId)
      : task;
  const pipelineMode = hasPipelineModeLabel(root?.labels);
  const directReports = await agentRegistry.getDirectReports(agent.id);
  const isManager = directReports.length > 0;

  const allTasks = await orchestrationStore.load('tasks');
  const rootTasks = allTasks.filter((t) => (t.rootTaskId ?? t.id) === rootId || t.id === rootId);

  const scope = { id: task.id, rootTaskId: rootId };
  const workflow = isManager
    ? await loadPipelineWorkflow(scope)
    : await loadPipelineWorkflow(scope).then(async (w) => {
        if (w) return w;
        for (const t of rootTasks) {
          const wf = await loadPipelineWorkflow({ id: t.id, rootTaskId: rootId });
          if (wf) return wf;
        }
        return null;
      });

  const userDecision = await loadUserDecision(scope);

  const blockersOpen = !(await taskWorkflow.areBlockersSatisfied(task));
  const openBlockerTitles: string[] = [];
  if (blockersOpen && task.blockedBy?.length) {
    for (const id of task.blockedBy) {
      const blocker = allTasks.find((t) => t.id === id);
      if (blocker && blocker.status !== 'done') {
        openBlockerTitles.push(`${blocker.title} (${blocker.status})`);
      }
    }
  }

  const enforceArtifactIo =
    pipelineMode && cfg.agent.artifactOnlyIo !== false;
  const requireWorkflowBeforeDelegate =
    pipelineMode && isManager && cfg.agent.requirePipelineWorkflow !== false;

  let allowedReadPaths: ReadAllowlistResult | undefined;
  if (enforceArtifactIo) {
    allowedReadPaths = await buildWorkerReadAllowlist(task, rootTasks, workflow, {
      isManager,
    });
  }

  return {
    pipelineMode,
    isManager,
    allowedReadPaths,
    workflow,
    userDecision,
    blockersOpen,
    openBlockerTitles,
    enforceArtifactIo,
    requireWorkflowBeforeDelegate,
  };
}

async function taskManagerSafeGet(id: string): Promise<Task | null> {
  const tasks = await orchestrationStore.load('tasks');
  return tasks.find((t) => t.id === id) ?? null;
}

export async function formatRunPrepPromptSections(
  prep: OrchestrationRunPrep,
  task: Task,
): Promise<string[]> {
  const parts: string[] = [];
  const rootId = task.rootTaskId ?? task.id;

  if (prep.requireWorkflowBeforeDelegate && prep.isManager && !prep.workflow) {
    parts.push(
      `\n--- PIPELINE CHECKLIST (required) ---\n` +
        `1. Write \`pipeline/workflow.json\` to your task artifact folder (use write_file).\n` +
        `2. Delegate subtasks matching each workflow phase (create_subtask).\n` +
        `3. Monitor progress — do not complete until subtasks exist and finish.\n` +
        `Do NOT call route_to_skill or create_subtask until workflow.json exists and validates.`,
    );
  } else if (prep.workflow && prep.isManager) {
    parts.push(`\n${formatWorkflowExcerpt(prep.workflow)}`);
    parts.push(
      `\nPipeline checklist: 1) workflow.json ✓ 2) Delegate per phases 3) Monitor subtasks`,
    );
  }

  if (prep.workflow && !prep.isManager) {
    const phase =
      prep.workflow.phases.find(
        (p) => p.title.toLowerCase() === task.title.trim().toLowerCase(),
      ) ?? null;
    if (phase) {
      parts.push(
        `\nYour workflow phase: ${phase.title}\n` +
          `Responsibilities: ${(phase.responsibilities ?? []).join('; ') || 'see workflow.json'}`,
      );
    }
  }

  if (prep.blockersOpen) {
    parts.push(
      `\n--- BLOCKED — open dependencies ---\n` +
        `Do not run research or design skills until blockers complete.\n` +
        `Open blockers: ${prep.openBlockerTitles.join(', ') || task.blockedBy?.join(', ') || 'unknown'}`,
    );
  } else if (task.blockedBy?.length) {
    parts.push(`\nDependencies satisfied — you may start work on "${task.title}".`);
  }

  if (prep.userDecision) {
    parts.push(
      `\n--- USER DECISION (binding — do not re-research) ---\n` +
        `${prep.userDecision.decision}\n` +
        `Do not route_to_skill to research fallback skills; proceed to the next workflow phase per workflow.json.`,
    );
  }

  if (prep.enforceArtifactIo && prep.allowedReadPaths) {
    parts.push(
      `\n--- ALLOWED READS (artifact I/O) ---\n` +
        prep.allowedReadPaths.descriptions.map((d) => `- ${d}`).join('\n') +
        `\nWrite ONLY to your artifact folder. Reads outside this list are denied.`,
    );
    const ownRel = `workspace/orchestration/artifacts/${rootId}/${task.id}`;
    const upstream = await listUpstreamDeliverablePaths(prep.allowedReadPaths, ownRel);
    if (upstream.length > 0) {
      parts.push(
        `\nUpstream deliverables you may read:\n${upstream.slice(0, 25).map((p) => `- \`${p}\``).join('\n')}`,
      );
    }
  }

  return parts;
}
