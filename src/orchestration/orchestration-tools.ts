import { DynamicStructuredTool } from '@langchain/core/tools';

import { z } from 'zod';

import { agentRegistry } from './agent-registry';

import { taskManager } from './task-manager';

import {
  delegateFromWorkflow,
  findOpenOverlappingSubtask,
  resolveAssigneeId,
  spawnTasksFromParent,
} from './orchestration-delegation';
import { isAwaitingParentAnswer } from './orchestration-parent-clarification';
import { hasPipelineModeLabel } from './orchestration-labels';
import { loadPipelineWorkflow } from './pipeline-workflow';
import { configManager } from '../config/index';

import { getOpenParentQuestion } from './orchestration-parent-clarification';

import type { Task } from './types';
import { softenTools } from '../utils/soften-tool-schema';



export interface OrchestrationToolContext {

  agentId: string;

  taskId?: string;

}



export async function buildOrchestrationTools(

  ctx: OrchestrationToolContext,

): Promise<DynamicStructuredTool[]> {

  const tools: DynamicStructuredTool[] = [

    new DynamicStructuredTool({

      name: 'ask_user',

      description:

        'Pause and ask the human user for a decision (e.g. which eBook to build, approval to proceed). ' +

        'Use when workflow.json has requiresUserApproval or instructions say STOP AND ASK USER. ' +

        'Do NOT use ask_parent_manager for human/user approval — that tool is only for subtask assignees with a parent manager.',

      schema: z.object({

        question: z.string().describe('Clear question for the human user'),

        summary: z

          .string()

          .optional()

          .describe('Markdown summary of findings/options (e.g. top 5 products table)'),

      }),

      func: async ({ question, summary }) => {

        if (!ctx.taskId) return 'No active task context.';

        const trimmed = question.trim();

        if (!trimmed) return 'question cannot be empty.';

        const pending = await taskManager.hasPendingUserClarification(ctx.taskId);

        if (pending) {

          return 'Already awaiting user input on this task. Wait for the human to answer in the admin UI.';

        }

        const fullQuestion = summary?.trim() ? `${summary.trim()}\n\n${trimmed}` : trimmed;

        const saved = await taskManager.pauseForUserClarification(

          ctx.taskId,

          ctx.agentId,

          fullQuestion,

        );

        if (!saved) return 'Could not pause for user clarification.';

        return (

          `Paused awaiting USER input on "${saved.title}" (status: ${saved.status}). ` +

          'The human will answer via the admin UI. Do not delegate downstream phases or call ask_user again until they respond.'

        );

      },

    }),

    new DynamicStructuredTool({

      name: 'ask_parent_manager',

      description:

        'Ask your parent manager a clarification question (subtask assignees only). ' +

        'NOT for human/user approval — use ask_user when the workflow requiresUserApproval or STOP AND ASK USER.',

      schema: z.object({

        question: z.string().describe('Clear question for your manager'),

      }),

      func: async ({ question }) => {
        if (!ctx.taskId) return 'No active task context.';
        try {
          const comments = await taskManager.getComments(ctx.taskId);
          const task = await taskManager.getTaskById(ctx.taskId);
          if (task && isAwaitingParentAnswer(task, comments)) {
            return 'You already have a pending question for your parent manager. Wait for their answer.';
          }
          const result = await taskManager.requestParentClarification(
            ctx.taskId,
            ctx.agentId,
            question,
          );
          const parent = await agentRegistry.getById(result.parentManagerId);
          return (
            `Question sent to ${parent?.name ?? result.parentManagerId}. ` +
            `Wait for their answer before continuing. Do not call ask_parent_manager again.`
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes('No parent manager found')) {
            return (
              `${message} For human/user decisions (e.g. which product to build), use ask_user instead.`
            );
          }
          return message;
        }
      },

    }),

  ];



  const reports = await agentRegistry.getDirectReports(ctx.agentId);

  if (reports.length > 0) {

    tools.push(

      new DynamicStructuredTool({

        name: 'delegate_from_workflow',

        description:

          'Create all subtasks from pipeline/workflow.json in one call (preferred for pipeline mode). ' +

          'Supersedes overlapping open subtasks. Sets parent to await subtask completion.',

        schema: z.object({}),

        func: async () => {

          if (!ctx.taskId) {

            return 'No active task context. delegate_from_workflow requires an assigned parent task.';

          }

          const manager = await agentRegistry.getById(ctx.agentId);

          if (!manager?.permissions.canCreateTasks || !manager.permissions.canAssignTasks) {

            return 'You do not have permission to delegate tasks.';

          }

          const parent = await taskManager.getTaskById(ctx.taskId);

          if (!parent) return `Parent task not found: ${ctx.taskId}`;

          const { summary } = await delegateFromWorkflow(manager, parent);

          return summary;

        },

      }),

      new DynamicStructuredTool({

        name: 'list_team_members',

        description:

          'List agents that report directly to you. Use before create_subtask to get valid assigneeId values.',

        schema: z.object({}),

        func: async () => {

          const manager = await agentRegistry.getById(ctx.agentId);

          if (!manager) return 'Manager agent not found.';

          if (reports.length === 0) {

            return 'No direct reports. You cannot delegate subtasks.';

          }

          return reports

            .map(

              (a) =>

                `${a.name} | id: ${a.id} | role: ${a.role} | title: ${a.title}`,

            )

            .join('\n');

        },

      }),

      new DynamicStructuredTool({

        name: 'create_subtask',

        description:

          'Create a subtask under your current assignment and assign it to a direct report. ' +

          'Prefer delegate_from_workflow for pipeline mode. Optional blockedBy: use subtask id from list_my_subtasks, workflow phase id (e.g. market-research), or ["previous"].',

        schema: z.object({

          title: z.string().describe('Short subtask title'),

          description: z

            .string()

            .describe('Detailed requirements for the assignee (Markdown ok)'),

          assigneeId: z.string().optional().describe('Agent id from list_team_members'),

          assigneeName: z

            .string()

            .optional()

            .describe('Agent name if id unknown (e.g. Product Engineering Agent)'),

          priority: z

            .enum(['low', 'medium', 'high', 'critical'])

            .optional()

            .describe('Subtask priority'),

          blockedBy: z

            .array(z.string())

            .optional()

            .describe(

              'Task ids or titles this waits on, or ["previous"] for the subtask created just before in the same batch',

            ),

        }),

        func: async ({ title, description, assigneeId, assigneeName, priority, blockedBy }) => {

          if (!ctx.taskId) {

            return 'No active task context. Subtasks can only be created while working on an assigned task.';

          }

          const manager = await agentRegistry.getById(ctx.agentId);

          if (!manager?.permissions.canCreateTasks) {

            return 'You do not have permission to create tasks.';

          }

          if (!manager.permissions.canAssignTasks) {

            return 'You do not have permission to assign tasks to other agents.';

          }

          const parent = await taskManager.getTaskById(ctx.taskId);

          if (!parent) return `Parent task not found: ${ctx.taskId}`;

          const existingSubtasks = await taskManager.getSubtasks(ctx.taskId);

          const duplicate = findOpenOverlappingSubtask(existingSubtasks, title);

          if (duplicate) {

            const blockers = (duplicate.blockedBy ?? []).join(', ') || 'none';

            return (

              `Subtask already exists (idempotent): "${duplicate.title}" (id: ${duplicate.id}) ` +

              `status: ${duplicate.status}, blockedBy: ${blockers}. Do not create duplicates — use list_my_subtasks.`

            );

          }

          const rootId = parent.rootTaskId ?? parent.id;
          const root =
            parent.rootTaskId && parent.rootTaskId !== parent.id
              ? await taskManager.getTaskById(rootId)
              : parent;
          if (
            root &&
            hasPipelineModeLabel(root.labels) &&
            configManager.getConfig().agent.requirePipelineWorkflow !== false
          ) {
            const workflow = await loadPipelineWorkflow({ id: parent.id, rootTaskId: rootId });
            if (!workflow) {
              return (
                'create_subtask blocked: write pipeline/workflow.json to your task artifact first ' +
                '(phases, blockedAfter, responsibilities), then delegate.'
              );
            }
          }

          const resolvedId = await resolveAssigneeId(

            manager.companyId,

            ctx.agentId,

            assigneeId,

            assigneeName,

          );

          if (!resolvedId) {

            const hint = reports.map((a) => `${a.name} (${a.id})`).join(', ');

            return `Invalid assignee. Your direct reports: ${hint || 'none'}`;

          }

          const result = await spawnTasksFromParent(parent, ctx.agentId, [

            {

              title,

              description,

              assigneeId: resolvedId,

              priority,

              blockedBy,

            },

          ]);

          const task = result[0];

          if (!task) return 'Subtask could not be created (check permissions or parent task).';

          const blockers = (task.blockedBy ?? []).join(', ') || 'none';

          let response = `Subtask created: "${task.title}" (id: ${task.id}) assigned to ${resolvedId}, status: ${task.status}, blockedBy: ${blockers}`;

          if (blockedBy?.length && !(task.blockedBy ?? []).length) {

            response += `\nWarning: blockedBy requested [${blockedBy.join(', ')}] but none resolved. Use subtask id from list_my_subtasks.`;

          }

          return response;

        },

      }),

      new DynamicStructuredTool({

        name: 'cancel_subtask',

        description:

          'Cancel a duplicate or mistaken subtask under your current parent task. Use subtask id from list_my_subtasks.',

        schema: z.object({

          subtaskId: z.string().optional().describe('Subtask id to cancel'),

          titleFragment: z

            .string()

            .optional()

            .describe('Partial title match if id unknown'),

        }),

        func: async ({ subtaskId, titleFragment }) => {

          if (!ctx.taskId) return 'No active task context.';

          if (!subtaskId && !titleFragment?.trim()) {

            return 'Provide subtaskId or titleFragment.';

          }

          const subtasks = await taskManager.getSubtasks(ctx.taskId);

          let target: Task | undefined;

          if (subtaskId) {

            target = subtasks.find((t) => t.id === subtaskId);

          }

          if (!target && titleFragment?.trim()) {

            const needle = titleFragment.trim().toLowerCase();

            target = subtasks.find((t) => t.title.toLowerCase().includes(needle));

          }

          if (!target) {

            return `Subtask not found under parent ${ctx.taskId}. Use list_my_subtasks.`;

          }

          if (target.status === 'done' || target.status === 'cancelled') {

            return `Subtask "${target.title}" (${target.id}) is already ${target.status}.`;

          }

          await taskManager.updateStatus(target.id, 'cancelled', ctx.agentId);

          return `Cancelled subtask "${target.title}" (${target.id}).`;

        },

      }),

      new DynamicStructuredTool({

        name: 'list_my_subtasks',

        description: 'List subtasks you created under the current parent task.',

        schema: z.object({}),

        func: async () => {

          if (!ctx.taskId) return 'No active task context.';

          const subtasks = await taskManager.getSubtasks(ctx.taskId);

          if (subtasks.length === 0) return 'No subtasks yet.';

          return subtasks

            .map((t: Task) => {

              const blockers = (t.blockedBy ?? []).join(', ') || 'none';

              return `${t.title} | id: ${t.id} | assignee: ${t.assigneeId ?? 'unassigned'} | status: ${t.status} | blockedBy: ${blockers}`;

            })

            .join('\n');

        },

      }),

      new DynamicStructuredTool({

        name: 'list_pending_subtask_questions',

        description:

          'List subtasks under your current task that asked you a question and are waiting for your answer.',

        schema: z.object({}),

        func: async () => {

          if (!ctx.taskId) return 'No active task context.';

          const pending = await taskManager.listSubtasksAwaitingParentAnswer(ctx.taskId);

          if (pending.length === 0) return 'No pending questions from subtasks.';

          return pending

            .map(

              (p) =>

                `Subtask: ${p.subtask.title} | id: ${p.subtask.id} | assignee: ${p.subtask.assigneeId ?? 'unassigned'}\nQuestion: ${p.question}`,

            )

            .join('\n\n');

        },

      }),

      new DynamicStructuredTool({

        name: 'reply_to_subtask_question',

        description:

          'Answer a direct report’s question on a subtask. Use list_pending_subtask_questions to find subtask ids.',

        schema: z.object({

          subtaskId: z.string().describe('Subtask id from list_pending_subtask_questions'),

          answer: z.string().describe('Your clarification answer (Markdown ok)'),

        }),

        func: async ({ subtaskId, answer }) => {

          try {

            const saved = await taskManager.answerParentClarification(

              subtaskId,

              ctx.agentId,

              answer,

            );

            return `Answer recorded on "${saved.title}". The assignee will be notified to continue.`;

          } catch (err: unknown) {

            return err instanceof Error ? err.message : String(err);

          }

        },

      }),

    );

  }



  return softenTools(tools);

}


