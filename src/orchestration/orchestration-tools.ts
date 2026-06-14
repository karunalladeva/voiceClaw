import { DynamicStructuredTool } from '@langchain/core/tools';

import { z } from 'zod';

import { agentRegistry } from './agent-registry';

import { taskManager } from './task-manager';

import { resolveAssigneeId, spawnTasksFromParent } from './orchestration-delegation';
import { isAwaitingParentAnswer } from './orchestration-parent-clarification';
import { hasPipelineModeLabel } from './orchestration-labels';
import { loadPipelineWorkflow } from './pipeline-workflow';
import { configManager } from '../config/index';

import { getOpenParentQuestion } from './orchestration-parent-clarification';

import type { Task } from './types';



export interface OrchestrationToolContext {

  agentId: string;

  taskId?: string;

}



export async function buildOrchestrationTools(

  ctx: OrchestrationToolContext,

): Promise<DynamicStructuredTool[]> {

  const tools: DynamicStructuredTool[] = [

    new DynamicStructuredTool({

      name: 'ask_parent_manager',

      description:

        'Ask your parent manager a clarification question about the current task. ' +

        'Pauses your work until they answer (use when requirements are unclear). ' +

        'For human/board escalation, that is a separate flow.',

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
          return err instanceof Error ? err.message : String(err);
        }
      },

    }),

  ];



  const reports = await agentRegistry.getDirectReports(ctx.agentId);

  if (reports.length > 0) {

    tools.push(

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

          'Optional blockedBy: omit for the first phase (starts immediately). Use a prior subtask id/title or ["previous"] so work runs in order (e.g. design after requirements).',

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

          return `Subtask created: "${task.title}" (id: ${task.id}) assigned to ${resolvedId}, status: ${task.status}, blockedBy: ${blockers}`;

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



  return tools;

}


