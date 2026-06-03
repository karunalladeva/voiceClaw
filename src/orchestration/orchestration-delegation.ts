import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { modelRouter } from '../models/model-router';
import { agentRegistry } from './agent-registry';
import { taskManager } from './task-manager';
import { hasPipelineModeLabel } from './orchestration-labels';
import { splitChapterSubtaskIfEnabled } from './pipeline-chapter-split';
import { titlesOverlap } from './pipeline-helpers';
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

import { looksLikeTaskId } from './orchestration-blocked-by';

function resolveBlockedByRefs(
  refs: string[] | undefined,
  parentTask: Task,
  createdByTitle: Map<string, string>,
  existingSubtasks: Task[],
  lastCreatedId?: string,
): string[] {
  if (!refs?.length) {
    if (lastCreatedId) return [lastCreatedId];
    return [];
  }
  const resolved: string[] = [];
  for (const ref of refs) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    if (trimmed === 'parent' || trimmed === parentTask.id) {
      resolved.push(parentTask.id);
      continue;
    }
    if (trimmed === 'previous') {
      if (lastCreatedId) resolved.push(lastCreatedId);
      continue;
    }
    const byTitle = createdByTitle.get(trimmed.toLowerCase());
    if (byTitle) {
      resolved.push(byTitle);
      continue;
    }
    const existing = existingSubtasks.find(
      (t) => t.title.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      resolved.push(existing.id);
      continue;
    }
    if (looksLikeTaskId(trimmed)) {
      resolved.push(trimmed);
    }
  }
  return resolved.length > 0 ? [...new Set(resolved)] : [];
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
  }  const created: Task[] = [];
  const createdByTitle = new Map<string, string>();
  const existingSubtasks = await taskManager.getSubtasks(parentTask.id);
  let lastCreatedId: string | undefined;
  for (const input of inputs) {
    try {
      const blockedBy = resolveBlockedByRefs(
        input.blockedBy,
        parentTask,
        createdByTitle,
        existingSubtasks,
        lastCreatedId,
      );
      const result = await taskManager.createSubtask(parentTask.id, {
        title: input.title,
        description: input.description,
        assigneeId: input.assigneeId,
        priority: input.priority ?? parentTask.priority,
        blockedBy,
        createdBy: creatorId,
      });
      if (isTask(result)) {
        createdByTitle.set(result.title.toLowerCase(), result.id);
        lastCreatedId = result.id;
        console.log(
          `[Orchestration] Subtask "${result.title}" → ${result.assigneeId} (${result.status}) blockedBy=[${(result.blockedBy ?? []).join(', ')}]`,
        );
        const chapterTasks = await splitChapterSubtaskIfEnabled(result, creatorId);
        if (chapterTasks.length > 0) {
          for (const chapterTask of chapterTasks) {
            created.push(chapterTask);
            createdByTitle.set(chapterTask.title.toLowerCase(), chapterTask.id);
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
  const response = await llm.invoke([
    new SystemMessage(
      'You assign work to direct reports. Reply with ONLY valid JSON, no markdown. ' +
        'Schema: {"spawnTasks":[{"title":"string","description":"string","assigneeId":"from roster","priority":"low|medium|high|critical","blockedBy":["parent|previous|sibling task title"],"blockedAfter":"sibling task title"}]}. ' +
        'Use blockedBy/blockedAfter for sequential work: e.g. requirements first, then design blockedAfter "Requirements gathering". ' +
        'Omit blockedBy on the first task (starts when the epic is active). Use blockedAfter or blockedBy with a prior subtask title for sequential phases.',
    ),
    new HumanMessage(
      `Manager: ${manager.name}\n` +
        `Parent task: ${parentTask.title}\n${parentTask.description}\n\n` +
        `Manager analysis / notes:\n${output.slice(0, 14000)}\n\n` +
        `Create one subtask per team member when their skills apply. Split requirements clearly.\n` +
        `Order sequential phases: research/requirements before engineering/design (use blockedAfter on the later task).\n` +
        `Roster (use exact assigneeId):\n${JSON.stringify(roster, null, 2)}`,
    ),
  ]);

  let text = '';
  if (typeof response.content === 'string') {
    text = response.content;
  } else if (Array.isArray(response.content)) {
    text = response.content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text?: string }).text ?? '');
        }
        return '';
      })
      .join('');
  } else {
    text = String(response.content ?? '');
  }

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
  const supersede =
    options?.supersede === true && hasPipelineModeLabel(root?.labels);
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

  let created = await applyDelegationFromOutput(manager, parentTask, output, options);
  if (created.length > 0) return { tasks: created, spawnedNewly: true };

  console.log(`[Orchestration] No subtasks from output/tools — generating assignments for ${manager.name}…`);
  const generated = await generateSpawnTasksWithLlm(manager, parentTask, output);
  if (generated.length === 0) {
    console.warn(`[Orchestration] LLM delegation produced no valid subtasks for ${parentTask.id}`);
    return { tasks: [], spawnedNewly: false };
  }
  created = await spawnTasksFromParent(parentTask, manager.id, generated, options);
  return { tasks: created, spawnedNewly: created.length > 0 };
}
export function formatTeamDelegationHint(reports: OrgAgent[]): string {
  if (reports.length === 0) return '';
  const roster = reports
    .map((a) => `- ${a.name} (id: ${a.id}, role: ${a.role}): ${a.title}`)
    .join('\n');
  return (
    `\n\n--- TEAM DELEGATION (required) ---\n` +
    `Direct reports:\n${roster}\n\n` +
    `You MUST call create_subtask once per team member who should execute next steps.\n` +
    `Use list_team_members if needed. Each description must list concrete deliverables.\n` +
    `For sequential work (e.g. requirements then design), create the first subtask first, then the next with blockedBy set to the prior subtask id (or blockedAfter in JSON).\n` +
    `Also end with a JSON block:\n` +
    '```json\n' +
    '{"spawnTasks":[{"title":"Gather requirements","description":"...","assigneeId":"agent-id","priority":"high"},{"title":"Product design","description":"...","assigneeId":"agent-id","blockedAfter":"Gather requirements","priority":"high"}]}\n' +
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
      `You manage ${reports.length} direct report(s). Delegation tools: list_team_members, create_subtask, list_my_subtasks, list_pending_subtask_questions, reply_to_subtask_question.`,
      `After route_to_skill returns, read the [Sub-Agent Result] synthesis first; use the "Orchestrator tool trace" section only if you need raw tool evidence. Then call create_subtask for each direct report — do not call route_to_skill again for the same skill id if VALIDATION RESUME says it is blocked (use partial data from the tool trace, a fallback skill once, or ask the user).`,
      `Do not create_subtask while the latest skill handoff is incomplete or missing required structured output — resolve with synthesis, fallback, or user clarification first.`,
      `Do not finish without creating subtasks for each report who must contribute.`,
      `Use sequential blockedBy when phases depend on each other (requirements before design).`,
      `Answer subtask questions with reply_to_subtask_question when list_pending_subtask_questions shows any.`,
    );
  } else {
    parts.push(
      `If requirements are unclear, use ask_parent_manager (your manager via reportsTo) before guessing.`,
    );
  }
  return parts.join('\n');
}
