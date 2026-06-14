import type { SpawnTaskInput, Task } from './types';
import type { OrgAgent } from './types';
import type { PipelineWorkflow } from './pipeline-workflow-schema';
import { resolveAssigneeId } from './orchestration-delegation';

export async function buildSpawnInputsFromWorkflow(
  manager: OrgAgent,
  parentTask: Task,
  workflow: PipelineWorkflow,
): Promise<SpawnTaskInput[]> {
  const inputs: SpawnTaskInput[] = [];
  for (const phase of workflow.phases) {
    let assigneeId = phase.assigneeId;
    if (!assigneeId && phase.assigneeName) {
      assigneeId =
        (await resolveAssigneeId(
          manager.companyId,
          manager.id,
          undefined,
          phase.assigneeName,
        )) ?? undefined;
    }
    if (!assigneeId) {
      assigneeId =
        (await resolveAssigneeId(
          manager.companyId,
          manager.id,
          undefined,
          phase.title,
        )) ?? undefined;
    }
    if (!assigneeId) continue;

    const description =
      [
        ...(phase.responsibilities ?? []),
        phase.expectedOutputs?.length
          ? `Expected outputs: ${phase.expectedOutputs.join(', ')}`
          : '',
        phase.requiresUserApproval ? 'STOP AND ASK user before proceeding to next phase.' : '',
      ]
        .filter(Boolean)
        .join('\n') || phase.title;

    const blockedBy = phase.blockedAfter ? [phase.blockedAfter] : undefined;
    inputs.push({
      title: phase.title,
      description,
      assigneeId,
      blockedBy,
      priority: parentTask.priority,
    });
  }
  return inputs;
}

export function validateSpawnMatchesWorkflow(
  inputs: SpawnTaskInput[],
  workflow: PipelineWorkflow,
): { ok: boolean; message?: string } {
  if (inputs.length === 0) {
    return { ok: false, message: 'No spawn tasks provided' };
  }
  const phaseTitles = workflow.phases.map((p) => p.title.toLowerCase());
  const spawnTitles = inputs.map((i) => i.title.trim().toLowerCase());
  const missing = phaseTitles.filter((t) => !spawnTitles.some((s) => s === t || s.includes(t)));
  if (missing.length > workflow.phases.length / 2) {
    return {
      ok: false,
      message: `Spawn tasks missing workflow phases: ${missing.join(', ')}. Match workflow.json phase titles.`,
    };
  }
  for (const phase of workflow.phases) {
    if (!phase.blockedAfter) continue;
    const spawn = inputs.find(
      (i) => i.title.trim().toLowerCase() === phase.title.toLowerCase(),
    );
    if (!spawn?.blockedBy?.length) {
      return {
        ok: false,
        message: `Phase "${phase.title}" must have blockedBy/blockedAfter "${phase.blockedAfter}"`,
      };
    }
  }
  return { ok: true };
}
