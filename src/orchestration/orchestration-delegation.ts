import { systemMessage, userMessage } from '../runtime/messages';
import { modelRouter } from '../models/model-router';
import { agentRegistry } from './agent-registry';
import { taskManager } from './task-manager';
import { hasPipelineModeLabel } from './orchestration-labels';
import { splitChapterSubtaskIfEnabled } from './pipeline-chapter-split';
import { normalizeTitleForMatch, titlesOverlap } from './pipeline-helpers';
import {
  buildSpawnInputsFromWorkflow,
  validateSpawnMatchesWorkflow,
} from './pipeline-delegation-template';
import {
  ensureDefaultPipelineWorkflow,
  loadPipelineWorkflow,
  loadUserDecision,
} from './pipeline-workflow';
import { resolveBlockedByRefs } from './orchestration-blocked-by-resolve';
import type { ApprovalRequest, OrgAgent, SpawnTaskInput, Task } from './types';

export interface DelegationResult {
  tasks: Task[];
  spawnedNewly: boolean;
}
function isTask(value: Task | ApprovalRequest): value is Task {
  return 'status' in value && 'companyId' in value;
}

export function parseSpawnTasksFromOutput(output: string): SpawnTaskInput[] {
  const fence = output.match(/```json\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : output;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const list = parsed.spawnTasks ?? parsed.spawnTask;
    if (!list) return [];
    const items = Array.isArray(list) ? list : [list];
    const result: SpawnTaskInput[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const title = typeof row.title === 'string' ? row.title.trim() : '';
      const description = typeof row.description === 'string' ? row.description.trim() : '';
      const assigneeId = typeof row.assigneeId === 'string' ? row.assigneeId.trim() : '';
      const assigneeName = typeof row.assigneeName === 'string' ? row.assigneeName.trim() : '';
      if (!title || !description || (!assigneeId && !assigneeName)) continue;
      let blockedBy = Array.isArray(row.blockedBy)
        ? row.blockedBy.filter((id): id is string => typeof id === 'string')
        : undefined;
      const blockedAfter =
        typeof row.blockedAfter === 'string'
          ? row.blockedAfter.trim()
          : typeof row.blockedByTitle === 'string'
            ? row.blockedByTitle.trim()
            : '';
      if (blockedAfter) {
        blockedBy = [...(blockedBy ?? []), blockedAfter];
      }
      const priority =
        row.priority === 'low' ||
        row.priority === 'medium' ||
        row.priority === 'high' ||
        row.priority === 'critical'
          ? row.priority
          : undefined;
      result.push({
        title,
        description,
        assigneeId: assigneeId || assigneeName,
        blockedBy,
        priority,
      });
    }
    return result;
  } catch {
    return [];
  }
}

export async function resolveAssigneeId(
  companyId: string,
  managerId: string,
  assigneeId?: string,
  assigneeName?: string,
): Promise<string | null> {
  const reports = await agentRegistry.getDirectReports(managerId);
  if (assigneeId?.trim()) {
    const byId = reports.find((a) => a.id === assigneeId.trim());
    if (byId) return byId.id;
    const needle = assigneeId.trim().toLowerCase();
    const byName = reports.find(
      (a) =>
        a.name.toLowerCase() === needle ||
        a.title.toLowerCase() === needle ||
        a.name.toLowerCase().includes(needle) ||
        a.title.toLowerCase().includes(needle),
    );
    if (byName) return byName.id;
  }
  if (!assigneeName?.trim()) return null;
  const needle = assigneeName.trim().toLowerCase();
  const byName = reports.find(
    (a) =>
      a.name.toLowerCase() === needle ||
      a.title.toLowerCase() === needle ||
      a.name.toLowerCase().includes(needle) ||
      a.title.toLowerCase().includes(needle),
  );
  return byName?.id ?? null;
}

async function resolveSpawnInputs(
  manager: OrgAgent,
  inputs: SpawnTaskInput[],
): Promise<SpawnTaskInput[]> {
  const resolved: SpawnTaskInput[] = [];
  for (const item of inputs) {
    const looksLikeId = item.assigneeId.includes('-') && item.assigneeId.length > 12;
    const assigneeId = await resolveAssigneeId(
      manager.companyId,
      manager.id,
      looksLikeId ? item.assigneeId : undefined,
      looksLikeId ? undefined : item.assigneeId,
    );
    if (!assigneeId) continue;
    resolved.push({ ...item, assigneeId });
  }
  return resolved;
}

/** After delegation: parent stays open until every listed subtask is done. */
export async function markParentAwaitingSubtasks(
  parentTask: Task,
  subtasks: Task[],
  actorId: string,
  replaceBlockedBy = false,
): Promise<void> {
  if (subtasks.length === 0) return;
  await taskManager.release(parentTask.id, actorId);
  await taskManager.setAwaitingSubtasks(
    parentTask.id,
    subtasks.map((s) => s.id),
    actorId,
    replaceBlockedBy,
  );
}

async function supersedeOpenSubtasks(
  parentTask: Task,
  inputs: SpawnTaskInput[],
): Promise<void> {
  const existing = await taskManager.getSubtasks(parentTask.id);
  const open = existing.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  for (const sub of open) {
    const overlaps = inputs.some((input) => titlesOverlap(input.title, sub.title));
    if (!overlaps) continue;
    await taskManager.updateStatus(sub.id, 'cancelled', parentTask.assigneeId ?? 'system');
    console.log(`[Orchestration] Superseded open subtask "${sub.title}" (${sub.id})`);
  }
}

export async function spawnTasksFromParent(
  parentTask: Task,
  creatorId: string,
  inputs: SpawnTaskInput[],
  options?: { supersede?: boolean },
): Promise<Task[]> {
  const rootId = parentTask.rootTaskId ?? parentTask.id;
  const root =
    rootId === parentTask.id ? parentTask : await taskManager.getTaskById(rootId);
  const supersede =
    options?.supersede === true && hasPipelineModeLabel(root?.labels);
  if (supersede) {
    await supersedeOpenSubtasks(parentTask, inputs);
  }
  const created: Task[] = [];
  const createdByTitle = new Map<string, string>();
  const createdByPhaseId = new Map<string, string>();
  const existingSubtasks = await taskManager.getSubtasks(parentTask.id);
  let lastCreatedId: string | undefined;
  for (const input of inputs) {
    try {
      const { resolved: blockedBy, unresolved } = resolveBlockedByRefs(input.blockedBy, {
        parentTask,
        createdByTitle,
        createdByPhaseId,
        existingSubtasks,
        lastCreatedId,
      });
      if (unresolved.length > 0) {
        console.warn(
          `[Orchestration] blockedBy unresolved for "${input.title}": ${unresolved.join(', ')}`,
        );
      }
      const result = await taskManager.createSubtask(parentTask.id, {
        title: input.title,
        description: input.description,
        assigneeId: input.assigneeId,
        priority: input.priority ?? parentTask.priority,
        blockedBy,
        createdBy: creatorId,
      });
      if (isTask(result)) {
        createdByTitle.set(normalizeTitleForMatch(result.title), result.id);
        if (input.phaseId) {
          createdByPhaseId.set(input.phaseId.toLowerCase(), result.id);
        }
        lastCreatedId = result.id;
        existingSubtasks.push(result);
        console.log(
          `[Orchestration] Subtask "${result.title}" → ${result.assigneeId} (${result.status}) blockedBy=[${(result.blockedBy ?? []).join(', ')}]`,
        );
        const chapterTasks = await splitChapterSubtaskIfEnabled(result, creatorId);
        if (chapterTasks.length > 0) {
          for (const chapterTask of chapterTasks) {
            created.push(chapterTask);
            createdByTitle.set(normalizeTitleForMatch(chapterTask.title), chapterTask.id);
            lastCreatedId = chapterTask.id;
          }
        } else {
          created.push(result);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Orchestration] Failed to create subtask "${input.title}": ${msg}`);
    }
  }
  return created;
}

export async function applyDelegationFromOutput(
  manager: OrgAgent,
  parentTask: Task,
  output: string,
  options?: { supersede?: boolean },
): Promise<Task[]> {
  const parsed = parseSpawnTasksFromOutput(output);
  if (parsed.length === 0) return [];
  const resolved = await resolveSpawnInputs(manager, parsed);
  if (resolved.length === 0) return [];
  return spawnTasksFromParent(parentTask, manager.id, resolved, options);
}
export async function generateSpawnTasksWithLlm(
  manager: OrgAgent,
  parentTask: Task,
  output: string,
): Promise<SpawnTaskInput[]> {
  const reports = await agentRegistry.getDirectReports(manager.id);
  if (reports.length === 0) return [];

  const roster = reports.map((a) => ({
    assigneeId: a.id,
    name: a.name,
    title: a.title,
    focus: a.description.slice(0, 400),
  }));

  const llm = await modelRouter.getMasterModel();
  const response = await llm.complete({
    messages: [
      systemMessage(
        'You assign work to direct reports. Reply with ONLY valid JSON, no markdown. ' +
          'Schema: {"spawnTasks":[{"title":"string","description":"string","assigneeId":"from roster","priority":"low|medium|high|critical","blockedBy":["parent|previous|sibling task title"],"blockedAfter":"sibling task title"}]}. ' +
          'Use blockedBy/blockedAfter for sequential work: e.g. requirements first, then design blockedAfter "Requirements gathering". ' +
          'Omit blockedBy on the first task (starts when the epic is active). Use blockedAfter or blockedBy with a prior subtask title for sequential phases.',
      ),
      userMessage(
        `Manager: ${manager.name}\n` +
          `Parent task: ${parentTask.title}\n${parentTask.description}\n\n` +
          `Manager analysis / notes:\n${output.slice(0, 14000)}\n\n` +
          `Create one subtask per team member when their skills apply. Split requirements clearly.\n` +
          `Order sequential phases: research/requirements before engineering/design (use blockedAfter on the later task).\n` +
          `Roster (use exact assigneeId):\n${JSON.stringify(roster, null, 2)}`,
      ),
    ],
    label: 'orchestration:spawn-tasks',
  });

  const text = response.content ?? '';

  const parsed = parseSpawnTasksFromOutput(text);
  return resolveSpawnInputs(manager, parsed);
}

/** Ensure direct reports get subtasks before the parent task is closed. */
export async function ensureTeamDelegation(
  manager: OrgAgent,
  parentTask: Task,
  output: string,
  options?: { supersede?: boolean },
): Promise<DelegationResult> {
  const existing = await taskManager.getSubtasks(parentTask.id);
  const rootId = parentTask.rootTaskId ?? parentTask.id;
  const root =
    rootId === parentTask.id ? parentTask : await taskManager.getTaskById(rootId);
  const pipelineMode = hasPipelineModeLabel(root?.labels);
  const supersede =
    options?.supersede === true && pipelineMode;
  if (existing.length > 0 && !supersede) {
    console.log(`[Orchestration] Parent task already has ${existing.length} subtask(s)`);
    return { tasks: existing, spawnedNewly: false };
  }

  const reports = await agentRegistry.getDirectReports(manager.id);
  if (reports.length === 0) return { tasks: [], spawnedNewly: false };

  if (!manager.permissions.canCreateTasks) {
    console.warn(`[Orchestration] ${manager.name} cannot create tasks — skipping delegation`);
    return { tasks: [], spawnedNewly: false };
  }

  let workflow = await loadPipelineWorkflow({ id: parentTask.id, rootTaskId: rootId });
  if (pipelineMode && !workflow) {
    workflow = await ensureDefaultPipelineWorkflow(
      { id: parentTask.id, rootTaskId: rootId },
      manager.id,
    );
    console.log(`[Orchestration] Bootstrapped default pipeline/workflow.json for ${parentTask.id}`);
  }

  let created = await applyDelegationFromOutput(manager, parentTask, output, options);
  if (created.length > 0) {
    if (workflow) {
      const validation = validateSpawnMatchesWorkflow(
        created.map((t) => ({
          title: t.title,
          description: t.description,
          assigneeId: t.assigneeId ?? '',
          blockedBy: t.blockedBy,
        })),
        workflow,
      );
      if (!validation.ok) {
        console.warn(`[Orchestration] Spawn/workflow mismatch: ${validation.message}`);
        await taskManager.addComment(
          parentTask.id,
          manager.id,
          'agent',
          `[DELEGATION_MISMATCH] ${validation.message}`,
        );
      }
    }
    return { tasks: created, spawnedNewly: true };
  }

  console.log(`[Orchestration] No subtasks from output/tools — generating assignments for ${manager.name}…`);
  let generated = await generateSpawnTasksWithLlm(manager, parentTask, output);
  if (generated.length === 0 && workflow) {
    generated = await buildSpawnInputsFromWorkflow(manager, parentTask, workflow);
  }
  if (generated.length === 0) {
    console.warn(`[Orchestration] LLM delegation produced no valid subtasks for ${parentTask.id}`);
    return { tasks: [], spawnedNewly: false };
  }
  if (workflow) {
    const validation = validateSpawnMatchesWorkflow(generated, workflow);
    if (!validation.ok) {
      console.warn(`[Orchestration] Generated spawn/workflow mismatch: ${validation.message}`);
    }
  }
  created = await spawnTasksFromParent(parentTask, manager.id, generated, options);
  return { tasks: created, spawnedNewly: created.length > 0 };
}

/** Find an open subtask under parent with overlapping title. */
export function findOpenOverlappingSubtask(subtasks: Task[], title: string): Task | undefined {
  return subtasks.find(
    (t) =>
      t.status !== 'done' &&
      t.status !== 'cancelled' &&
      titlesOverlap(t.title, title),
  );
}

/** Spawn all workflow phases as subtasks in one batch. */
export async function delegateFromWorkflow(
  manager: OrgAgent,
  parentTask: Task,
): Promise<{ tasks: Task[]; summary: string }> {
  const rootId = parentTask.rootTaskId ?? parentTask.id;
  let workflow = await loadPipelineWorkflow({ id: parentTask.id, rootTaskId: rootId });
  if (!workflow) {
    workflow = await ensureDefaultPipelineWorkflow(
      { id: parentTask.id, rootTaskId: rootId },
      manager.id,
    );
  }
  if (!workflow) {
    return {
      tasks: [],
      summary:
        'No pipeline/workflow.json found. Write workflow.json to your task artifact first, then call delegate_from_workflow.',
    };
  }
  const userDecision = await loadUserDecision({ id: parentTask.id, rootTaskId: rootId });
  const approvalPhase = workflow.phases.find((p) => p.requiresUserApproval);
  if (approvalPhase && !userDecision) {
    const downstreamCount = workflow.phases.filter(
      (p) => p.id !== approvalPhase.id && !titlesOverlap(p.title, approvalPhase.title),
    ).length;
    if (downstreamCount > 0) {
      return {
        tasks: [],
        summary:
          `Workflow phase "${approvalPhase.title}" requires USER approval before downstream phases. ` +
          `Present your research (e.g. competitor-shortlist.md) and call ask_user with the top options. ` +
          `After the human selects in the admin UI, call delegate_from_workflow again to spawn Product Engineering, Creative Design, and Creator.`,
      };
    }
  }
  const inputs = await buildSpawnInputsFromWorkflow(manager, parentTask, workflow);
  if (inputs.length === 0) {
    return {
      tasks: [],
      summary:
        'Could not map workflow phases to assignees. Set assigneeName on each phase or ensure direct reports match phase titles.',
    };
  }
  const created = await spawnTasksFromParent(parentTask, manager.id, inputs, { supersede: true });
  if (created.length > 0) {
    await markParentAwaitingSubtasks(parentTask, created, manager.id);
  }
  const lines = created.map((t) => {
    const blockers = (t.blockedBy ?? []).join(', ') || 'none';
    return `- ${t.title} | id: ${t.id} | assignee: ${t.assigneeId ?? 'unassigned'} | blockedBy: ${blockers}`;
  });
  return {
    tasks: created,
    summary:
      created.length > 0
        ? `Delegated ${created.length} phase(s) from workflow:\n${lines.join('\n')}`
        : 'No subtasks were created from workflow.',
  };
}

export function formatTeamDelegationHint(reports: OrgAgent[]): string {
  if (reports.length === 0) return '';
  const roster = reports
    .map((a) => `- ${a.name} (id: ${a.id}, role: ${a.role}): ${a.title}`)
    .join('\n');
  return (
    `\n\n--- TEAM DELEGATION (required) ---\n` +
    `Direct reports:\n${roster}\n\n` +
    `Pipeline mode: prefer delegate_from_workflow (one call) over multiple create_subtask calls.\n` +
    `Otherwise create one subtask per workflow phase (match phase title in workflow.json), not one per team member.\n` +
    `Use list_my_subtasks first — if all phases are already delegated, stop and do not create more.\n` +
    `For blockedBy, use subtask id from list_my_subtasks (most reliable) or workflow phase id (e.g. market-research).\n` +
    `When workflow requires user approval (requiresUserApproval), call ask_user — NOT ask_parent_manager.\n` +
    `Use cancel_subtask to remove duplicate subtasks you created by mistake.\n` +
    `Also end with a JSON block:\n` +
    '```json\n' +
    '{"spawnTasks":[{"title":"Market Research","description":"...","assigneeId":"agent-id","priority":"high"},{"title":"Product Engineering","description":"...","assigneeId":"agent-id","blockedAfter":"market-research","priority":"high"}]}\n' +
    '```'
  );
}

export function buildOrgOrchestrationSystemAppend(
  manager: OrgAgent,
  task: Task | null,
  reports: OrgAgent[],
): string {
  const parts = [
    `\n[ORCHESTRATION MODE] You are org agent "${manager.name}" (${manager.id}).`,
    `Permissions: createTasks=${manager.permissions.canCreateTasks}, assignTasks=${manager.permissions.canAssignTasks}.`,
  ];
  if (task) {
    parts.push(`Active task id: ${task.id} (use with create_subtask).`);
  }
  if (reports.length > 0) {
    parts.push(
      `You manage ${reports.length} direct report(s). Delegation tools: list_team_members, delegate_from_workflow, create_subtask, ask_user, list_my_subtasks, cancel_subtask, list_pending_subtask_questions, reply_to_subtask_question.`,
      `FIRST: write pipeline/workflow.json to your task artifact (phases, blockedAfter, readsFrom, responsibilities). Then call delegate_from_workflow once to spawn all phases.`,
      `If a phase has requiresUserApproval and research is done, call ask_user with the top options — wait for human selection before delegating downstream phases.`,
      `If delegate_from_workflow is unavailable, create one subtask per workflow phase title — not one per direct report.`,
      `After route_to_skill returns, read the [Sub-Agent Result] synthesis first; use the "Orchestrator tool trace" section only if you need raw tool evidence. Do not call route_to_skill again for the same skill id if VALIDATION RESUME says it is blocked (use partial data from the tool trace or ask the user).`,
      `Do not create_subtask while the latest skill handoff is incomplete or missing required structured output — resolve with synthesis or user clarification first.`,
      `If list_my_subtasks already shows all workflow phases delegated, stop — do not create more subtasks.`,
      `Use sequential blockedBy (subtask id or phase id) when phases depend on each other.`,
      `Answer subtask questions with reply_to_subtask_question when list_pending_subtask_questions shows any.`,
    );
  } else {
    parts.push(
      `If requirements are unclear, use ask_parent_manager (your manager via reportsTo) before guessing.`,
    );
  }
  return parts.join('\n');
}
