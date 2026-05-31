import { EventEmitter } from 'events';
import { agentRegistry } from './agent-registry';
import { taskManager } from './task-manager';
import { budgetTracker } from './budget-tracker';
import { orchestrationStore, generateId } from './store';
import type { OrgAgent, Task, ActivityEvent } from './types';
import { modelRegistry } from '../models/model-registry';
import { DEFAULT_ORG_MODEL_ID } from './agent-normalizer';
import { getOrgHeartbeatIntervalMs } from './agent-registry';
import { ensureTeamDelegation, markParentAwaitingSubtasks } from './orchestration-delegation';
import { getOpenParentQuestion } from './orchestration-parent-clarification';
import {
  detectAwaitingUserInput,
  extractUserClarificationQuestion,
} from './awaiting-user-input';
import { taskWorkflow } from './task-workflow';
import { isInferenceInterruptError } from '../utils/inference-interrupt';
import {
  getRootArtifactRelDir,
  getTaskArtifactRelDir,
  listSiblingTaskArtifactDirs,
} from './task-artifacts';

export interface HeartbeatResult {
  agentId: string;
  taskId?: string;
  success: boolean;
  skipped?: boolean;
  output?: string;
  error?: string;
  tokensUsed?: number;
  durationMs: number;
}

export interface TriggerHeartbeatOptions {
  /** When true, interval-driven heartbeats do not run the LLM if no task is queued. */
  skipIfNoTask?: boolean;
}

export type HeartbeatMode = 'work' | 'review';

type HeartbeatHandler = (
  agent: OrgAgent,
  task: Task | null,
  context: string,
  mode: HeartbeatMode,
) => Promise<string>;

class HeartbeatScheduler extends EventEmitter {
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private handler: HeartbeatHandler | null = null;
  private running = false;
  private runningHeartbeats = new Set<string>();
  private pendingWakeups = new Map<string, NodeJS.Timeout>();
  private lastSkipLogAt = new Map<string, number>();
  private static readonly SKIP_LOG_INTERVAL_MS = 60_000;

  setHandler(handler: HeartbeatHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const agents = await agentRegistry.list();
    for (const agent of agents) {
      if (
        agent.heartbeat.enabled &&
        (agent.status === 'active' || agent.status === 'idle')
      ) {
        this.scheduleAgent(agent);
      }
    }

    setInterval(() => this.checkSchedules(), 60000);

    void this.wakeReviewersForPendingTasks();

    const triggerForTask = async (task: Task, assigneeId?: string) => {
      const targetId = assigneeId ?? task.assigneeId ?? task.reviewerId;
      if (!targetId) return;
      console.log(`[Orchestration] Auto-triggering heartbeat for: ${task.title}`);
      try {
        await this.triggerHeartbeat(targetId);
      } catch (err: any) {
        console.error(`[Orchestration] Auto-trigger failed: ${err.message}`);
      }
    };
    taskManager.on('task:created', (task) => triggerForTask(task, task.assigneeId));
    taskManager.on('task:review_needed', (task) => triggerForTask(task, task.reviewerId));
    taskManager.on('task:unblocked', (task) => triggerForTask(task, task.assigneeId));
    taskManager.on(
      'task:parent_question',
      (payload: { parentManagerId: string; task: Task }) => {
        console.log(
          `[Orchestration] Waking parent manager ${payload.parentManagerId} — question on "${payload.task.title}"`,
        );
        void this.triggerHeartbeat(payload.parentManagerId);
      },
    );
    taskManager.on('task:parent_answered', (payload: { assigneeId: string }) => {
      this.scheduleDebouncedHeartbeat(payload.assigneeId, 'parent_answered');
    });

    console.log('[Orchestration] Heartbeat scheduler started (with auto-task pickup)');
  }

  stop(): void {
    this.running = false;
    for (const [id, interval] of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();
    console.log('[Orchestration] Heartbeat scheduler stopped');
  }

  /** Coalesce task events so parent_answered + 15s interval do not overlap one agent. */
  private scheduleDebouncedHeartbeat(agentId: string, reason: string, delayMs: number = 2500): void {
    const existing = this.pendingWakeups.get(agentId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingWakeups.delete(agentId);
      if (this.runningHeartbeats.has(agentId)) {
        console.log(
          `[Orchestration] Deferred ${reason} wakeup for ${agentId} — heartbeat already running`,
        );
        this.scheduleDebouncedHeartbeat(agentId, reason, delayMs);
        return;
      }
      void this.triggerHeartbeat(agentId);
    }, delayMs);
    this.pendingWakeups.set(agentId, timer);
  }

  /** After restart, review tasks do not re-emit task:review_needed — wake reviewers explicitly. */
  private async wakeReviewersForPendingTasks(): Promise<void> {
    const tasks = await taskManager.listTasks();
    const reviewerIds = new Set<string>();
    for (const task of tasks) {
      if (task.status === 'review' && task.reviewerId) {
        reviewerIds.add(task.reviewerId);
      }
    }
    let wakeIndex = 0;
    for (const reviewerId of reviewerIds) {
      const agent = await agentRegistry.getById(reviewerId);
      if (!agent?.heartbeat.enabled) continue;
      const reviewCount = tasks.filter(
        (t) => t.status === 'review' && t.reviewerId === reviewerId,
      ).length;
      const delayMs = wakeIndex * 3000;
      wakeIndex += 1;
      setTimeout(() => {
        console.log(
          `[Orchestration] Waking ${agent.name} for ${reviewCount} review task(s)`,
        );
        void this.triggerHeartbeat(reviewerId);
      }, delayMs);
    }
  }

  private scheduleAgent(agent: OrgAgent): void {
    if (this.intervals.has(agent.id)) {
      clearInterval(this.intervals.get(agent.id)!);
    }

    const intervalMs = getOrgHeartbeatIntervalMs(agent.heartbeat.intervalMs);
    agent.heartbeat.intervalMs = intervalMs;

    const interval = setInterval(
      () => this.triggerHeartbeat(agent.id, { skipIfNoTask: true }),
      intervalMs,
    );

    this.intervals.set(agent.id, interval);
    console.log(`[Orchestration] Scheduled heartbeat for ${agent.name} every ${intervalMs}ms`);
  }

  async triggerHeartbeat(agentId: string, options?: TriggerHeartbeatOptions): Promise<HeartbeatResult> {
    const startTime = Date.now();
    if (this.runningHeartbeats.has(agentId)) {
      return {
        agentId,
        success: false,
        error: 'Heartbeat already in progress for this agent',
        durationMs: Date.now() - startTime,
      };
    }
    this.runningHeartbeats.add(agentId);
    try {
    const agent = await agentRegistry.getById(agentId);

    if (!agent) {
      return {
        agentId,
        success: false,
        error: 'Agent not found',
        durationMs: Date.now() - startTime,
      };
    }

    if (agent.status !== 'active' && agent.status !== 'idle') {
      return {
        agentId,
        success: false,
        error: `Agent status is ${agent.status}`,
        durationMs: Date.now() - startTime,
      };
    }

    const budgetCheck = await budgetTracker.checkBudget(agentId);
    if (!budgetCheck.canProceed) {
      return {
        agentId,
        success: false,
        error: budgetCheck.warning || 'Budget exceeded',
        durationMs: Date.now() - startTime,
      };
    }

    const next = await taskManager.getNextTask(agentId);
    const mode: HeartbeatMode = next?.mode ?? 'work';
    const answerSubtaskQuestions = next?.answerSubtaskQuestions ?? false;
    let activeTask: Task | null = next?.task ?? null;
    if (activeTask && mode === 'review') {
      console.log(`[Orchestration] ${agent.name} reviewing "${activeTask.title}"`);
    }

    if (options?.skipIfNoTask && !activeTask) {
      await this.updateHeartbeatTiming(agentId);
      const now = Date.now();
      const lastLogged = this.lastSkipLogAt.get(agentId) ?? 0;
      if (now - lastLogged >= HeartbeatScheduler.SKIP_LOG_INTERVAL_MS) {
        console.log(`[Orchestration] Heartbeat skipped for ${agent.name}: no task in queue`);
        this.lastSkipLogAt.set(agentId, now);
      }
      return {
        agentId,
        success: true,
        skipped: true,
        output: 'Skipped: no task in queue',
        durationMs: Date.now() - startTime,
      };
    }

    let checkedOutTask: Task | null = null;

    if (activeTask && mode === 'work' && !answerSubtaskQuestions) {
      try {
        checkedOutTask = await taskManager.resumeOrCheckout(activeTask.id, agentId);
        activeTask = checkedOutTask;
      } catch (err: any) {
        console.log(`[Orchestration] Could not checkout task: ${err.message}`);
        activeTask = null;
      }
    } else if (answerSubtaskQuestions && activeTask) {
      console.log(
        `[Orchestration] ${agent.name} answering subtask questions for "${activeTask.title}" (no checkout)`,
      );
    }

    const context = await this.buildContext(agent, activeTask, mode);

    await agentRegistry.updateStatus(agentId, 'active');

    let result: HeartbeatResult;

    try {
      if (!this.handler) {
        throw new Error('No heartbeat handler configured');
      }

      const output = await this.handler(agent, activeTask, context, mode);

      if (activeTask && mode === 'review') {
        await this.applyReviewDecision(activeTask.id, agentId, output);
      } else if (answerSubtaskQuestions && activeTask) {
        const pending = await taskManager.listSubtasksAwaitingParentAnswer(activeTask.id);
        if (pending.length > 0) {
          console.log(
            `[Orchestration] ${agent.name} should use reply_to_subtask_question for ${pending.length} pending question(s)`,
          );
        }
      } else if (checkedOutTask || (activeTask && mode === 'work' && !answerSubtaskQuestions && activeTask.status === 'in_progress' && activeTask.checkedOutBy === agentId)) {
        const workTask = checkedOutTask ?? activeTask!;
        const workProduct = {
          type: 'artifact' as const,
          title: `Heartbeat output: ${workTask.title}`,
          content: output,
        };
        if (detectAwaitingUserInput(output, workTask)) {
          const question = extractUserClarificationQuestion(output, workTask);
          console.log(
            `[Orchestration] ${agent.name} awaiting user input on "${workTask.title}" — routing to clarification`,
          );
          await taskManager.pauseForUserClarification(
            workTask.id,
            agentId,
            question,
            workProduct,
          );
        } else {
        const reports = await agentRegistry.getDirectReports(agent.id);
        if (reports.length > 0) {
          const { tasks: spawned, spawnedNewly } = await ensureTeamDelegation(
            agent,
            workTask,
            output,
          );
          if (spawned.length === 0) {
            console.warn(
              `[Orchestration] ${agent.name} completed "${workTask.title}" without creating subtasks`,
            );
            await taskManager.complete(workTask.id, agentId, workProduct);
          } else {
            console.log(
              `[Orchestration] ${agent.name} delegated ${spawned.length} subtask(s) to team`,
            );
            await taskWorkflow.saveWorkProduct(workTask.id, agentId, {
              type: 'artifact',
              title: `Delegation plan: ${workTask.title}`,
              content: output,
            });
            if (spawnedNewly) {
              await markParentAwaitingSubtasks(workTask, spawned, agentId, false);
            }
          }
        } else {
          await taskManager.complete(workTask.id, agentId, workProduct);
        }
        }
      }

      result = {
        agentId,
        taskId: activeTask?.id,
        success: true,
        output,
        durationMs: Date.now() - startTime,
      };

      this.emit('heartbeat:success', result);
    } catch (err: any) {
      const interrupted = isInferenceInterruptError(err);
      if (checkedOutTask && !interrupted) {
        await taskManager.release(checkedOutTask.id, agentId);
      }

      result = {
        agentId,
        taskId: activeTask?.id,
        success: false,
        error: interrupted
          ? 'Interrupted by model handoff; will retry on next heartbeat'
          : err.message,
        durationMs: Date.now() - startTime,
      };

      if (interrupted) {
        console.warn(
          `[Orchestration] Heartbeat interrupted for ${agent.name} (model busy); keeping task checked out`,
        );
      } else {
        this.emit('heartbeat:error', result);
      }
    }

    await agentRegistry.updateStatus(agentId, 'idle');

    await this.updateHeartbeatTiming(agentId);

    await this.logActivity({
      companyId: agent.companyId,
      actorId: agentId,
      actorType: 'agent',
      action: result.success ? 'heartbeat:completed' : 'heartbeat:failed',
      entityType: 'agent',
      entityId: agentId,
      data: {
        taskId: result.taskId,
        durationMs: result.durationMs,
        error: result.error,
      },
    });

    return result;
    } finally {
      this.runningHeartbeats.delete(agentId);
    }
  }

  private async buildContext(
    agent: OrgAgent,
    task: Task | null,
    mode: HeartbeatMode,
  ): Promise<string> {
    const parts: string[] = [];

    parts.push(`You are ${agent.name}, ${agent.title}.`);
    parts.push(`Role: ${agent.role}`);
    parts.push(`Description (Markdown):\n${agent.description}`);
    parts.push(this.formatModelContextLine(agent));
    if (agent.skills.length > 0) {
      parts.push(`Allowed capabilities: ${agent.skills.join(', ')}`);
    }

    if (task) {
      const hierarchy = await taskManager.getGoalHierarchy(task.id);

      if (hierarchy.company) {
        parts.push(`\nCompany Mission (Markdown):\n${hierarchy.company.mission}`);
      }

      if (hierarchy.goal) {
        parts.push(`\nCurrent Goal: ${hierarchy.goal.title}`);
        parts.push(`Goal Description (Markdown):\n${hierarchy.goal.description}`);
      }

      if (mode === 'review') {
        parts.push('\n--- MANAGER REVIEW MODE ---');
        const chain = task.reviewChain ?? [];
        const level = chain.indexOf(agent.id) + 1;
        const total = chain.length;
        if (total > 0 && level > 0) {
          parts.push(`Review level ${level} of ${total} in management chain.`);
        }
        if (task.submittedById) {
          const worker = await agentRegistry.getById(task.submittedById);
          parts.push(`Reviewing work submitted by: ${worker?.name ?? task.submittedById}`);
        }
        const products = await taskManager.getWorkProducts(task.id);
        const latest = products.sort((a, b) => b.createdAt - a.createdAt)[0];
        if (latest?.content) {
          parts.push(`\nSubmitted output (Markdown):\n${latest.content}`);
        }
        if ((task.reworkCount ?? 0) > 0) {
          const comments = await taskManager.getComments(task.id);
          const reworkNotes = comments.filter(c => c.content.startsWith('[Rework]')).pop();
          if (reworkNotes) parts.push(`\nRework notes:\n${reworkNotes.content}`);
        }
      }

      parts.push(`\nTask: ${task.title}`);
      parts.push(`Task Description (Markdown):\n${task.description}`);
      parts.push(`Priority: ${task.priority}`);
      const rootId = task.rootTaskId ?? task.id;
      const artifactDir = getTaskArtifactRelDir({ id: task.id, rootTaskId: rootId });
      parts.push(
        `\nTask artifact folder (save ALL deliverables here — chapters, images, PDFs):\n\`${artifactDir}/\``,
      );
      const artifactAbs = `${process.cwd().replace(/\\/g, '/')}/${artifactDir}`;
      parts.push(
        `\nFile I/O rules:\n` +
          `- Artifact folder already exists on disk — do NOT loop mkdir/shell to create it.\n` +
          `- Prefer \`write_file\` / \`read_file\` (file-manager skill): saves under the task artifact folder automatically.\n` +
          `- Shell cwd is \`workspace/\` (not repo root). From shell use \`orchestration/artifacts/...\` OR absolute \`${artifactAbs}/\`.\n` +
          `- Never use bash \`mkdir -p\` on Windows; use write_file or one PowerShell mkdir if required.`,
      );
      const siblingDirs = await listSiblingTaskArtifactDirs(rootId);
      const peerDirs = siblingDirs.filter((d) => !d.endsWith(`/${task.id}`));
      if (peerDirs.length > 0) {
        parts.push(
          `\nSibling task artifact folders under \`${getRootArtifactRelDir(rootId)}/\`:\n${peerDirs.map((d) => `- \`${d}/\``).join('\n')}`,
        );
      }
      if (task.inputContext?.trim()) {
        parts.push(`\nUpstream outputs (Markdown):\n${task.inputContext}`);
      }
      const depCtx = await taskManager.getDependencyContext(task.id);
      if (depCtx && !task.inputContext?.includes(depCtx)) {
        parts.push(`\nDependency context (Markdown):\n${depCtx}`);
      }
      const taskComments = await taskManager.getComments(task.id);
      const openQuestion = getOpenParentQuestion(taskComments);
      if (openQuestion) {
        parts.push(
          `\n--- WAITING FOR PARENT ANSWER ---\nYou asked your manager:\n${openQuestion}\nDo not proceed until they reply (or use ask_parent_manager again if urgent).`,
        );
      }
      const answered = taskComments
        .filter((c) => c.content.startsWith('[Parent answer]'))
        .pop();
      if (answered && !openQuestion) {
        parts.push(`\nLatest parent answer:\n${answered.content}`);
      }
      if (mode === 'work') {
        const reports = await agentRegistry.getDirectReports(agent.id);
        if (reports.length > 0 && task.id) {
          const pending = await taskManager.listSubtasksAwaitingParentAnswer(task.id);
          if (pending.length > 0) {
            parts.push('\n--- SUBTASK QUESTIONS (answer with reply_to_subtask_question) ---');
            for (const p of pending) {
              parts.push(
                `\nSubtask "${p.subtask.title}" (${p.subtask.id}) from assignee ${p.subtask.assigneeId}:\n${p.question}`,
              );
            }
          }
        }
      }
    } else {
      parts.push('\nNo specific task assigned. Check for work or perform routine duties.');
    }

    const budgetCheck = await budgetTracker.checkBudget(agent.id);
    if (budgetCheck.warning) {
      parts.push(`\nBudget Warning: ${budgetCheck.warning}`);
    }

    return parts.join('\n');
  }

  private parseReviewJson(output: string): Record<string, unknown> | null {
    const fence = output.match(/```json\s*([\s\S]*?)```/i);
    const raw = fence ? fence[1] : output;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async applyReviewDecision(taskId: string, reviewerId: string, output: string): Promise<void> {
    const parsed = this.parseReviewJson(output);
    const decision = (parsed?.decision as string) || 'request_clarification';
    const valid = new Set([
      'approve_escalate',
      'approve_release',
      'rework',
      'reassign',
      'escalate_user',
      'request_clarification',
    ]);
    const finalDecision = valid.has(decision) ? decision : 'request_clarification';
    await taskManager.processReview(taskId, reviewerId, {
      decision: finalDecision as import('./types').ReviewDecision,
      notes: typeof parsed?.notes === 'string' ? parsed.notes : output.slice(0, 500),
      nextAssigneeId: typeof parsed?.nextAssigneeId === 'string' ? parsed.nextAssigneeId : undefined,
      spawnTask: parsed?.spawnTask as import('./types').SpawnTaskInput | undefined,
    });
  }

  private formatModelContextLine(agent: OrgAgent): string {
    const modelId = agent.modelId ?? DEFAULT_ORG_MODEL_ID;
    if (modelId === DEFAULT_ORG_MODEL_ID) {
      const master = modelRegistry.getMaster();
      const label = master ? `${master.name} (${master.model})` : 'master';
      return `Model: master — ${label}`;
    }
    const config = modelRegistry.getById(modelId);
    if (!config) return `Model: ${modelId}`;
    return `Model: ${config.name || config.id} (${config.provider}/${config.model})`;
  }

  private async updateHeartbeatTiming(agentId: string): Promise<void> {
    const agents = await agentRegistry.list();
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    agent.heartbeat.lastBeat = Date.now();
    agent.heartbeat.nextBeat = Date.now() + agent.heartbeat.intervalMs;

    await orchestrationStore.save('agents', agents);
  }

  private async checkSchedules(): Promise<void> {
    if (!this.running) return;

    const agents = await agentRegistry.list();

    for (const agent of agents) {
      if (agent.heartbeat.enabled && (agent.status === 'active' || agent.status === 'idle')) {
        if (!this.intervals.has(agent.id)) {
          this.scheduleAgent(agent);
        }
      } else {
        if (this.intervals.has(agent.id)) {
          clearInterval(this.intervals.get(agent.id)!);
          this.intervals.delete(agent.id);
        }
      }
    }
  }

  async enableHeartbeat(agentId: string, intervalMs?: number): Promise<boolean> {
    const agents = await agentRegistry.list();
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return false;

    const effectiveMs = getOrgHeartbeatIntervalMs(intervalMs ?? agent.heartbeat.intervalMs);
    agent.heartbeat.enabled = true;
    agent.heartbeat.intervalMs = effectiveMs;
    agent.heartbeat.nextBeat = Date.now() + effectiveMs;

    await orchestrationStore.save('agents', agents);

    if (agent.status === 'active' || agent.status === 'idle') {
      this.scheduleAgent(agent);
    }

    return true;
  }

  async disableHeartbeat(agentId: string): Promise<boolean> {
    const agents = await agentRegistry.list();
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return false;

    agent.heartbeat.enabled = false;
    await orchestrationStore.save('agents', agents);

    if (this.intervals.has(agentId)) {
      clearInterval(this.intervals.get(agentId)!);
      this.intervals.delete(agentId);
    }

    return true;
  }

  private async logActivity(event: Omit<ActivityEvent, 'id' | 'timestamp'>): Promise<void> {
    await orchestrationStore.appendActivity({
      id: generateId(),
      timestamp: Date.now(),
      ...event,
    });
  }
}

export const heartbeatScheduler = new HeartbeatScheduler();
