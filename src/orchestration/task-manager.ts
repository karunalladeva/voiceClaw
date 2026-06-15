import { EventEmitter } from 'events';
import { orchestrationStore, generateId } from './store';
import { companyManager } from './company-manager';
import { agentRegistry } from './agent-registry';
import { taskWorkflow, TaskWorkflowError } from './task-workflow';
import { normalizeTask, normalizeTasks, isAgentCreatedBy } from './task-normalizer';
import {
  AWAITING_PARENT_LABEL,
  PARENT_ANSWER_PREFIX,
  PARENT_QUESTION_PREFIX,
  getOpenParentQuestion,
  isAwaitingParentAnswer,
  resolveParentManagerIdWithLookup,
} from './orchestration-parent-clarification';
import {
  AWAITING_USER_LABEL,
  hasAwaitingUserLabel,
} from './awaiting-user-input';
import { normalizeBlockedByIds, pruneStaleBlockedByIds } from './orchestration-blocked-by';
import { ensureTaskArtifactDir } from './task-artifacts';
import { saveUserDecision } from './pipeline-workflow';
import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskComment,
  WorkProduct,
  Goal,
  ActivityEvent,
  ApprovalRequest,
  ReviewDecisionPayload,
} from './types';

export interface CreateTaskInput {
  companyId: string;
  goalId?: string;
  parentTaskId?: string;
  rootTaskId?: string;
  title: string;
  description: string;
  priority?: TaskPriority;
  assigneeId?: string;
  createdBy: string;
  labels?: string[];
  dueAt?: number;
  blockedBy?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  assigneeId?: string | null;
  blockedBy?: string[];
  labels?: string[];
}

export interface CreateGoalInput {
  companyId: string;
  parentId?: string;
  title: string;
  description: string;
  targetMetric?: string;
  targetValue?: string;
  deadline?: number;
  createdBy: string;
}

class TaskManager extends EventEmitter {
  constructor() {
    super();
    taskWorkflow.on('task:review_needed', (task: Task) => this.emit('task:review_needed', task));
    taskWorkflow.on('task:unblocked', (task: Task) => this.emit('task:unblocked', task));
    taskWorkflow.on('task:created', (task: Task) => this.emit('task:created', task));
    taskWorkflow.on('task:completed', (task: Task) => {
      this.emit('task:completed', task);
      if (task.parentTaskId) {
        void this.tryCompleteDelegatedParent(
          task.parentTaskId,
          task.assigneeId ?? task.checkedOutBy ?? 'system',
        );
      }
    });
  }

  private async loadAllTasks(): Promise<Task[]> {
    const raw = await orchestrationStore.load('tasks');
    const tasks = normalizeTasks(raw);
    return this.repairTaskData(tasks);
  }

  private async repairTaskData(tasks: Task[]): Promise<Task[]> {
    let changed = false;
    for (const task of tasks) {
      if (
        task.status === 'review' &&
        task.labels?.includes(AWAITING_PARENT_LABEL)
      ) {
        task.labels = task.labels.filter((l) => l !== AWAITING_PARENT_LABEL);
        changed = true;
      }
    }
    if (changed) {
      await orchestrationStore.save('tasks', tasks);
      console.log('[Orchestration] Removed awaiting-parent label from review tasks');
    }
    return this.repairInvalidBlockedBy(tasks);
  }

  /** Fix blockedBy entries that stored titles instead of task ids. */
  private async repairInvalidBlockedBy(tasks: Task[]): Promise<Task[]> {
    let changed = false;
    for (const task of tasks) {
      if (!task.blockedBy?.length) continue;
      const normalized = normalizeBlockedByIds(task.blockedBy, tasks);
      const pruned = pruneStaleBlockedByIds(normalized, tasks);
      const same =
        pruned.length === task.blockedBy.length &&
        pruned.every((id, i) => id === task.blockedBy![i]);
      if (same) continue;
      task.blockedBy = pruned;
      changed = true;
      if (task.status === 'backlog' || task.status === 'todo') {
        const blockersOpen = await taskWorkflow.areBlockersSatisfied(task);
        task.status = blockersOpen ? 'todo' : 'backlog';
      }
    }
    for (const task of tasks) {
      if (task.status !== 'backlog' || !task.parentTaskId) continue;
      const subtasks = tasks.filter((t) => t.parentTaskId === task.id);
      if (subtasks.length > 0 && (task.blockedBy?.length ?? 0) > 0) {
        task.status = 'in_progress';
        changed = true;
      }
    }
    if (changed) {
      await orchestrationStore.save('tasks', tasks);
      console.log('[Orchestration] Repaired invalid blockedBy / parent backlog state');
    }
    return tasks;
  }

  async listTasks(companyId?: string): Promise<Task[]> {
    const tasks = await this.loadAllTasks();
    if (companyId) return tasks.filter(t => t.companyId === companyId);
    return tasks;
  }

  async listGoals(companyId?: string): Promise<Goal[]> {
    const goals = await orchestrationStore.load('goals');
    if (companyId) return goals.filter(g => g.companyId === companyId);
    return goals;
  }

  async getTaskById(id: string): Promise<Task | undefined> {
    const tasks = await this.loadAllTasks();
    return tasks.find(t => t.id === id);
  }

  async getSubtasks(parentTaskId: string): Promise<Task[]> {
    const tasks = await this.loadAllTasks();
    return tasks
      .filter((t) => t.parentTaskId === parentTaskId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async listSubtasksAwaitingParentAnswer(
    parentTaskId: string,
  ): Promise<Array<{ subtask: Task; question: string }>> {
    const subtasks = await this.getSubtasks(parentTaskId);
    const pending: Array<{ subtask: Task; question: string }> = [];
    for (const subtask of subtasks) {
      if (subtask.status === 'review' || subtask.status === 'done' || subtask.status === 'cancelled') {
        continue;
      }
      const comments = await this.getComments(subtask.id);
      const question = getOpenParentQuestion(comments);
      if (question) pending.push({ subtask, question });
    }
    return pending;
  }

  async getGoalById(id: string): Promise<Goal | undefined> {
    const goals = await orchestrationStore.load('goals');
    return goals.find(g => g.id === id);
  }

  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const goals = await orchestrationStore.load('goals');
    const goal: Goal = {
      id: generateId(),
      companyId: input.companyId,
      parentId: input.parentId,
      title: input.title,
      description: input.description,
      targetMetric: input.targetMetric,
      targetValue: input.targetValue,
      deadline: input.deadline,
      status: 'active',
      createdAt: Date.now(),
      createdBy: input.createdBy,
    };
    goals.push(goal);
    await orchestrationStore.save('goals', goals);
    await this.logActivity({
      companyId: input.companyId,
      actorId: input.createdBy,
      actorType: 'human',
      action: 'goal:created',
      entityType: 'goal',
      entityId: goal.id,
      data: { title: goal.title },
    });
    console.log(`[Orchestration] Goal created: ${goal.title}`);
    return goal;
  }

  async createTask(input: CreateTaskInput): Promise<Task | ApprovalRequest> {
    const company = await companyManager.getById(input.companyId);
    if (!company) throw new Error(`Company not found: ${input.companyId}`);
    const agents = await agentRegistry.getByCompany(input.companyId);
    const agentIds = new Set(agents.map(a => a.id));
    const isAgent = isAgentCreatedBy(input.createdBy, agentIds);
    if (isAgent) {
      const creator = await agentRegistry.getById(input.createdBy);
      if (!creator?.permissions.canCreateTasks) {
        throw new Error('Agent does not have permission to create tasks');
      }
      if (!input.assigneeId) {
        throw new Error('Agent-created tasks require assigneeId');
      }
      if (!input.rootTaskId && !input.parentTaskId) {
        throw new Error('Agent-created tasks require rootTaskId or parentTaskId');
      }
    }
    if (input.parentTaskId) {
      const parentTask = await this.getTaskById(input.parentTaskId);
      if (!parentTask) throw new Error(`Parent task not found: ${input.parentTaskId}`);
      if (parentTask.companyId !== input.companyId) {
        throw new Error('Parent task must belong to the same company.');
      }
    }
    const needsApproval =
      company.settings.requireApprovalForHighPriorityTasks &&
      (input.priority === 'critical' || input.priority === 'high');
    const taskId = generateId();
    const rootTaskId = isAgent
      ? input.rootTaskId ?? (input.parentTaskId
          ? (await this.getTaskById(input.parentTaskId))?.rootTaskId
          : undefined)
      : taskId;
    if (isAgent && !rootTaskId) {
      throw new Error('Could not resolve rootTaskId for agent task');
    }
    const task: Task = normalizeTask({
      id: taskId,
      companyId: input.companyId,
      goalId: input.goalId,
      parentTaskId: input.parentTaskId,
      rootTaskId: rootTaskId || taskId,
      source: isAgent ? 'agent' : 'user',
      title: input.title,
      description: input.description,
      status: needsApproval ? 'backlog' : isAgent ? 'backlog' : 'todo',
      priority: input.priority || 'medium',
      assigneeId: input.assigneeId,
      createdBy: input.createdBy,
      blockedBy: input.blockedBy ?? [],
      labels: input.labels || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dueAt: input.dueAt,
      reworkCount: 0,
    });
    if (isAgent && rootTaskId) {
      const root = await this.getTaskById(rootTaskId);
      if (!root || root.source !== 'user') {
        throw new Error('Agent tasks must hang off a user root task');
      }
      if (root.status === 'cancelled' || root.status === 'backlog') {
        task.status = 'backlog';
      } else if (input.blockedBy?.length) {
        let waitingOnBlocker = false;
        for (const blockerId of input.blockedBy) {
          const blocker = await this.getTaskById(blockerId);
          if (!blocker || blocker.status !== 'done') {
            waitingOnBlocker = true;
            break;
          }
        }
        task.status = waitingOnBlocker ? 'backlog' : 'todo';
      } else {
        task.status = 'todo';
      }
    }
    if (needsApproval) {
      return this.createTaskApproval(task);
    }
    const tasks = await orchestrationStore.load('tasks');
    tasks.push(task);
    await orchestrationStore.save('tasks', tasks);
    await this.logActivity({
      companyId: input.companyId,
      actorId: input.createdBy,
      actorType: isAgent ? 'agent' : 'human',
      action: 'task:created',
      entityType: 'task',
      entityId: task.id,
      data: { title: task.title, priority: task.priority, source: task.source },
    });
    console.log(`[Orchestration] Task created: ${task.title}`);
    if (task.assigneeId && task.status === 'todo') {
      this.emit('task:created', task);
    }
    return task;
  }

  async createSubtask(parentTaskId: string, input: Omit<CreateTaskInput, 'companyId' | 'parentTaskId'>): Promise<Task | ApprovalRequest> {
    const parentTask = await this.getTaskById(parentTaskId);
    if (!parentTask) throw new Error(`Parent task not found: ${parentTaskId}`);
    const subtaskInput: CreateTaskInput = {
      ...input,
      companyId: parentTask.companyId,
      parentTaskId,
      rootTaskId: parentTask.rootTaskId ?? parentTask.id,
      goalId: input.goalId ?? parentTask.goalId,
      blockedBy: input.blockedBy ?? [],
    };
    return this.createTask(subtaskInput);
  }

  /** Parent waits on subtasks; call after delegation instead of completing the parent immediately. */
  async setAwaitingSubtasks(
    parentTaskId: string,
    subtaskIds: string[],
    actorId: string,
    replaceBlockedBy = false,
  ): Promise<Task | null> {
    if (subtaskIds.length === 0) {
      const existing = await this.getTaskById(parentTaskId);
      return existing ?? null;
    }
    const parent = await this.getTaskById(parentTaskId);
    const blockedBy = replaceBlockedBy
      ? subtaskIds
      : [...new Set([...(parent?.blockedBy ?? []), ...subtaskIds])];
    return this.updateTask(
      parentTaskId,
      { blockedBy, status: 'in_progress' },
      actorId,
    );
  }

  async refreshUpstreamContext(taskId: string): Promise<Task> {
    return taskWorkflow.refreshUpstreamContext(taskId);
  }

  async refreshUpstreamContextForRoot(rootTaskId: string): Promise<Task[]> {
    return taskWorkflow.refreshUpstreamContextForRoot(rootTaskId);
  }

  /** When all subtasks finish and the parent was blocked on them, mark the parent done. */
  async tryCompleteDelegatedParent(parentTaskId: string, actorId: string): Promise<void> {
    const parent = await this.getTaskById(parentTaskId);
    if (!parent || parent.status === 'done' || parent.status === 'cancelled') return;
    const subtasks = await this.getSubtasks(parentTaskId);
    if (subtasks.length === 0) return;
    const subtaskIds = new Set(subtasks.map((s) => s.id));
    const blockedBy = parent.blockedBy ?? [];
    const parentWaitsOnSubtasks =
      blockedBy.length > 0 && blockedBy.every((id) => subtaskIds.has(id));
    if (!parentWaitsOnSubtasks) return;
    if (!subtasks.every((s) => s.status === 'done' || s.status === 'cancelled')) return;
    await this.updateStatus(parentTaskId, 'done', actorId);
  }

  private async createTaskApproval(task: Task): Promise<ApprovalRequest> {
    const approvals = await orchestrationStore.load('approvals');
    const approval: ApprovalRequest = {
      id: generateId(),
      companyId: task.companyId,
      type: 'task',
      requesterId: task.createdBy,
      requesterType: 'human',
      title: `Approve high-priority task: ${task.title}`,
      description: task.description,
      data: { task },
      status: 'pending',
      createdAt: Date.now(),
    };
    approvals.push(approval);
    await orchestrationStore.save('approvals', approvals);
    console.log(`[Orchestration] Approval required for task: ${task.title}`);
    return approval;
  }

  async checkout(taskId: string, agentId: string): Promise<Task | null> {
    await taskWorkflow.canCheckout(taskId, agentId);
    return orchestrationStore.mutateTasks((tasks) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return null;
      if (task.checkedOutBy && task.checkedOutBy !== agentId) {
        throw new Error(`Task already checked out by ${task.checkedOutBy}`);
      }
      if (task.status !== 'todo' && task.status !== 'backlog') {
        throw new Error(`Task cannot be checked out in status: ${task.status}`);
      }
      task.checkedOutBy = agentId;
      task.checkedOutAt = Date.now();
      task.status = 'in_progress';
      task.updatedAt = Date.now();
      if (!task.assigneeId) task.assigneeId = agentId;
      void this.logActivity({
        companyId: task.companyId,
        actorId: agentId,
        actorType: 'agent',
        action: 'task:checked_out',
        entityType: 'task',
        entityId: taskId,
        data: { title: task.title },
      });
      console.log(`[Orchestration] Task checked out: ${task.title} by ${agentId}`);
      return normalizeTask(task);
    });
  }

  /** Continue an in-progress checkout or start a fresh checkout. */
  async resumeOrCheckout(taskId: string, agentId: string): Promise<Task | null> {
    const existing = await this.getTaskById(taskId);
    if (!existing) return null;
    const scope = { id: existing.id, rootTaskId: existing.rootTaskId ?? existing.id };
    if (
      existing.status === 'in_progress' &&
      existing.checkedOutBy === agentId &&
      existing.assigneeId === agentId
    ) {
      await ensureTaskArtifactDir(scope);
      return orchestrationStore.mutateTasks((tasks) => {
        const task = tasks.find((t) => t.id === taskId);
        if (!task) return null;
        task.updatedAt = Date.now();
        console.log(`[Orchestration] Resuming in-progress task: ${task.title}`);
        return normalizeTask(task);
      });
    }
    const checkedOut = await this.checkout(taskId, agentId);
    if (checkedOut) {
      await ensureTaskArtifactDir({
        id: checkedOut.id,
        rootTaskId: checkedOut.rootTaskId ?? checkedOut.id,
      });
    }
    return checkedOut;
  }

  async release(taskId: string, agentId: string): Promise<Task | null> {
    const tasks = await orchestrationStore.load('tasks');
    const task = tasks.find(t => t.id === taskId);
    if (!task) return null;
    if (task.checkedOutBy !== agentId) {
      throw new Error(`Task not checked out by ${agentId}`);
    }
    task.checkedOutBy = undefined;
    task.checkedOutAt = undefined;
    task.status = 'todo';
    task.updatedAt = Date.now();
    await orchestrationStore.save('tasks', tasks);
    await this.logActivity({
      companyId: task.companyId,
      actorId: agentId,
      actorType: 'agent',
      action: 'task:released',
      entityType: 'task',
      entityId: taskId,
      data: { title: task.title },
    });
    return normalizeTask(task);
  }

  async updateStatus(taskId: string, status: TaskStatus, actorId: string): Promise<Task | null> {
    return this.updateTask(taskId, { status }, actorId);
  }

  async bulkUpdateStatus(params: {
    companyId?: string;
    status: TaskStatus;
    fromStatuses?: TaskStatus[];
    actorId?: string;
  }): Promise<{ updated: Task[]; count: number }> {
    const actorId = params.actorId ?? 'admin';
    const candidates = await this.listTasks(params.companyId);
    const updated: Task[] = [];
    for (const task of candidates) {
      if (task.status === params.status) continue;
      if (params.fromStatuses && !params.fromStatuses.includes(task.status)) continue;
      const saved = await this.updateStatus(task.id, params.status, actorId);
      if (saved) updated.push(saved);
    }
    return { updated, count: updated.length };
  }

  async updateTask(
    taskId: string,
    input: UpdateTaskInput,
    actorId: string = 'admin',
  ): Promise<Task | null> {
    const tasks = await orchestrationStore.load('tasks');
    const index = tasks.findIndex(t => t.id === taskId);
    if (index === -1) return null;
    const task = normalizeTask(tasks[index]);
    const oldStatus = task.status;
    const changes: Record<string, unknown> = {};

    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new Error('title cannot be empty');
      task.title = title;
      changes.title = title;
    }
    if (input.description !== undefined) {
      const description = input.description.trim();
      if (!description) throw new Error('description cannot be empty');
      task.description = description;
      changes.description = true;
    }
    if (input.priority !== undefined) {
      task.priority = input.priority;
      changes.priority = input.priority;
    }
    if (input.assigneeId !== undefined) {
      task.assigneeId = input.assigneeId || undefined;
      changes.assigneeId = task.assigneeId;
    }
    if (input.blockedBy !== undefined) {
      const blockedBy = [...new Set(input.blockedBy.filter(id => id && id !== taskId))];
      task.blockedBy = blockedBy;
      changes.blockedBy = blockedBy;
      if (task.status === 'backlog' || task.status === 'todo') {
        const blockersOpen = await taskWorkflow.areBlockersSatisfied(normalizeTask(task));
        task.status = blockersOpen ? 'todo' : 'backlog';
      }
    }
    if (input.labels !== undefined) {
      task.labels = [...new Set(input.labels)];
      changes.labels = task.labels;
    }
    if (input.status !== undefined && input.status !== task.status) {
      task.status = input.status;
      changes.status = { from: oldStatus, to: input.status };
      if (input.status === 'review' && !task.reviewerId && task.assigneeId) {
        const chain = await taskWorkflow.resolveManagementChain(task.assigneeId);
        if (chain.length > 0) {
          task.reviewerId = chain[0].id;
          task.reviewChain = chain.map(m => m.id);
          if (!task.submittedById) task.submittedById = task.assigneeId;
        }
      }
      if (input.status === 'done') {
        task.completedAt = Date.now();
        task.checkedOutBy = undefined;
        task.checkedOutAt = undefined;
        task.reviewerId = undefined;
        task.reviewChain = undefined;
        task.submittedAt = undefined;
      } else {
        if (oldStatus === 'done') {
          task.completedAt = undefined;
        }
        if (input.status === 'in_progress') {
          task.reviewerId = undefined;
          task.reviewChain = undefined;
          task.submittedAt = undefined;
          if (!task.checkedOutBy) {
            task.checkedOutBy = task.assigneeId ?? actorId;
            task.checkedOutAt = Date.now();
          }
        } else {
          task.checkedOutBy = undefined;
          task.checkedOutAt = undefined;
        }
        if (input.status === 'todo' || input.status === 'backlog') {
          task.reviewerId = undefined;
          task.reviewChain = undefined;
          task.submittedAt = undefined;
          task.submittedById = undefined;
        }
      }
    }

    task.updatedAt = Date.now();
    tasks[index] = task;
    await orchestrationStore.save('tasks', tasks);

    if (input.status === 'done' || (input.status === undefined && task.status === 'done' && oldStatus !== 'done')) {
      await taskWorkflow.unblockDependents(taskId);
    }

    const actorType = actorId === 'admin' || actorId.startsWith('user') ? 'human' : 'agent';
    await this.logActivity({
      companyId: task.companyId,
      actorId,
      actorType,
      action: input.status !== undefined ? 'task:status_changed' : 'task:updated',
      entityType: 'task',
      entityId: taskId,
      data: changes,
    });

    const saved = normalizeTask(task);
    const labelOnlyAwaitingParent =
      input.labels !== undefined &&
      input.status === undefined &&
      (saved.labels?.includes(AWAITING_PARENT_LABEL) ?? false);
    if (
      saved.assigneeId &&
      saved.status === 'todo' &&
      !labelOnlyAwaitingParent &&
      !saved.labels?.includes(AWAITING_PARENT_LABEL)
    ) {
      this.emit('task:created', saved);
    }
    if (input.status === 'done' && oldStatus !== 'done') {
      this.emit('task:completed', saved);
    }
    if (
      !saved.rootTaskId &&
      (input.status === 'done' || input.status === 'cancelled') &&
      oldStatus !== input.status
    ) {
      void import('../models/model-load-coordinator').then(({ modelLoadCoordinator }) => {
        modelLoadCoordinator.unpinPipeline(saved.id);
      });
    }
    return saved;
  }

  async submitForReview(
    taskId: string,
    agentId: string,
    workProduct?: Partial<WorkProduct>,
  ): Promise<Task | null> {
    try {
      const before = await this.getTaskById(taskId);
      let task = await taskWorkflow.submitForReview(taskId, agentId, workProduct);
      const autoReleased = await taskWorkflow.tryAutoReleasePipelineSubtask(taskId);
      if (autoReleased) task = autoReleased;
      if (before?.labels?.includes(AWAITING_PARENT_LABEL)) {
        const labels = task.labels.filter((l) => l !== AWAITING_PARENT_LABEL);
        await this.updateTask(taskId, { labels }, agentId);
        task = (await this.getTaskById(taskId)) ?? task;
      }
      await this.logActivity({
        companyId: task.companyId,
        actorId: agentId,
        actorType: 'agent',
        action: 'task:submitted_for_review',
        entityType: 'task',
        entityId: taskId,
        data: { reviewerId: task.reviewerId, status: task.status },
      });
      return task;
    } catch (e) {
      if (e instanceof TaskWorkflowError) throw new Error(e.message);
      throw e;
    }
  }

  async processReview(
    taskId: string,
    reviewerId: string,
    payload: ReviewDecisionPayload,
  ): Promise<Task | null> {
    try {
      const task = await taskWorkflow.processReviewDecision(taskId, reviewerId, payload);
      const isHuman =
        reviewerId === 'admin' || reviewerId === 'human' || reviewerId.startsWith('user');
      await this.logActivity({
        companyId: task.companyId,
        actorId: reviewerId,
        actorType: isHuman ? 'human' : 'agent',
        action: `task:review_${payload.decision}`,
        entityType: 'task',
        entityId: taskId,
        data: { decision: payload.decision, status: task.status },
      });
      return task;
    } catch (e) {
      if (e instanceof TaskWorkflowError) throw new Error(e.message);
      throw e;
    }
  }

  async requestParentClarification(
    taskId: string,
    agentId: string,
    question: string,
  ): Promise<{ task: Task; parentManagerId: string }> {
    const trimmed = question.trim();
    if (!trimmed) throw new Error('question cannot be empty');
    const task = await this.getTaskById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.assigneeId && task.assigneeId !== agentId) {
      throw new Error('Only the assignee can ask the parent manager');
    }
    const existingComments = await this.getComments(taskId);
    if (isAwaitingParentAnswer(task, existingComments)) {
      const parentManagerId = await resolveParentManagerIdWithLookup(agentId, task, (id) =>
        this.getTaskById(id),
      );
      if (!parentManagerId) {
        throw new Error('No parent manager found (set reportsTo on the agent or use a subtask under a manager task)');
      }
      return { task, parentManagerId };
    }
    const parentManagerId = await resolveParentManagerIdWithLookup(agentId, task, (id) =>
      this.getTaskById(id),
    );
    if (!parentManagerId) {
      throw new Error('No parent manager found (set reportsTo on the agent or use a subtask under a manager task)');
    }
    const parent = await agentRegistry.getById(parentManagerId);
    await this.addComment(
      taskId,
      agentId,
      'agent',
      `${PARENT_QUESTION_PREFIX} ${trimmed}`,
    );
    const labels = [...new Set([...(task.labels ?? []), AWAITING_PARENT_LABEL])];
    const updated =
      (await this.updateTask(
        taskId,
        {
          labels,
          status: 'backlog',
        },
        agentId,
      )) ?? task;
    const tasks = await orchestrationStore.load('tasks');
    const row = tasks.find((t) => t.id === taskId);
    if (row) {
      row.checkedOutBy = undefined;
      row.checkedOutAt = undefined;
      row.updatedAt = Date.now();
      await orchestrationStore.save('tasks', tasks);
    }
    const saved = (await this.getTaskById(taskId)) ?? updated;
    await this.logActivity({
      companyId: task.companyId,
      actorId: agentId,
      actorType: 'agent',
      action: 'task:parent_question',
      entityType: 'task',
      entityId: taskId,
      data: { parentManagerId, parentName: parent?.name },
    });
    this.emit('task:parent_question', { task: saved, parentManagerId, question: trimmed });
    console.log(
      `[Orchestration] Parent question on "${task.title}" → ${parent?.name ?? parentManagerId}`,
    );
    return { task: saved, parentManagerId };
  }

  async answerParentClarification(
    subtaskId: string,
    parentAgentId: string,
    answer: string,
  ): Promise<Task> {
    const trimmed = answer.trim();
    if (!trimmed) throw new Error('answer cannot be empty');
    const subtask = await this.getTaskById(subtaskId);
    if (!subtask) throw new Error(`Task not found: ${subtaskId}`);
    const expectedParent = await resolveParentManagerIdWithLookup(
      subtask.assigneeId ?? parentAgentId,
      subtask,
      (id) => this.getTaskById(id),
    );
    if (expectedParent && expectedParent !== parentAgentId) {
      throw new Error('You are not the parent manager for this subtask');
    }
    const comments = await this.getComments(subtaskId);
    if (!getOpenParentQuestion(comments)) {
      throw new Error('No open parent question on this subtask');
    }
    await this.addComment(subtaskId, parentAgentId, 'agent', `${PARENT_ANSWER_PREFIX} ${trimmed}`);
    const labels = (subtask.labels ?? []).filter((l) => l !== AWAITING_PARENT_LABEL);
    const priorContext = subtask.inputContext?.trim() ?? '';
    const parent = await agentRegistry.getById(parentAgentId);
    const section = `### Parent clarification (${parent?.name ?? parentAgentId})\n\n${trimmed}`;
    const inputContext = priorContext ? `${priorContext}\n\n${section}` : section;
    const updated =
      (await this.updateTask(
        subtaskId,
        { labels, status: subtask.status === 'backlog' ? 'todo' : subtask.status },
        parentAgentId,
      )) ?? subtask;
    const tasks = await orchestrationStore.load('tasks');
    const index = tasks.findIndex((t) => t.id === subtaskId);
    if (index !== -1) {
      tasks[index].inputContext = inputContext;
      tasks[index].updatedAt = Date.now();
      await orchestrationStore.save('tasks', tasks);
    }
    const saved = normalizeTask({ ...updated, inputContext });
    await this.logActivity({
      companyId: subtask.companyId,
      actorId: parentAgentId,
      actorType: 'agent',
      action: 'task:parent_answer',
      entityType: 'task',
      entityId: subtaskId,
      data: { subtaskTitle: subtask.title },
    });
    if (saved.assigneeId) {
      this.emit('task:parent_answered', { task: saved, assigneeId: saved.assigneeId });
    }
    console.log(`[Orchestration] Parent answered on subtask "${subtask.title}"`);
    return saved;
  }

  async hasPendingUserClarification(taskId: string): Promise<boolean> {
    const approvals = await orchestrationStore.load('approvals');
    return approvals.some(
      (a) =>
        a.status === 'pending' &&
        a.type === 'clarification' &&
        (a.data as { taskId?: string }).taskId === taskId,
    );
  }

  /** Pause work and route to human approval when agent output awaits user input. */
  async pauseForUserClarification(
    taskId: string,
    agentId: string,
    question: string,
    workProduct?: Partial<WorkProduct>,
  ): Promise<Task | null> {
    const task = await this.getTaskById(taskId);
    if (!task) return null;
    if (workProduct) {
      await taskWorkflow.saveWorkProduct(taskId, agentId, workProduct);
    }
    if (task.checkedOutBy === agentId) {
      await this.release(taskId, agentId);
    }
    const hasPending = await this.hasPendingUserClarification(taskId);
    let saved: Task | null = task;
    if (!hasPending) {
      saved = await this.processReview(taskId, agentId, {
        decision: 'request_clarification',
        notes: question,
      });
    } else if (task.status !== 'blocked') {
      saved = await this.updateStatus(taskId, 'blocked', agentId);
    }
    const labels = [...new Set([...(saved?.labels ?? task.labels ?? []), AWAITING_USER_LABEL])];
    saved =
      (await this.updateTask(
        taskId,
        { labels, status: 'blocked' },
        agentId,
      )) ?? saved;
    if (saved?.completedAt) {
      const tasks = await orchestrationStore.load('tasks');
      const row = tasks.find((t) => t.id === taskId);
      if (row) {
        row.completedAt = undefined;
        row.updatedAt = Date.now();
        await orchestrationStore.save('tasks', tasks);
        saved = normalizeTask(row);
      }
    }
    await this.logActivity({
      companyId: task.companyId,
      actorId: agentId,
      actorType: 'agent',
      action: 'task:awaiting_user',
      entityType: 'task',
      entityId: taskId,
      data: { question: question.slice(0, 500) },
    });
    console.log(`[Orchestration] Task awaiting user clarification: ${task.title}`);
    return saved;
  }

  async resumeAfterUserClarification(
    taskId: string,
    reviewerId: string,
    response: string,
  ): Promise<Task | null> {
    const trimmed = response.trim();
    if (!trimmed) throw new Error('response cannot be empty');
    const task = await this.getTaskById(taskId);
    if (!task) return null;
    await this.addComment(taskId, reviewerId, 'human', `[Clarification] ${trimmed}`);
    const priorContext = task.inputContext?.trim() ?? '';
    const bindingSection = `### User decision (binding)\n\n${trimmed}`;
    const section = `### User clarification\n\n${trimmed}`;
    const inputContext = priorContext
      ? `${priorContext}\n\n${bindingSection}\n\n${section}`
      : `${bindingSection}\n\n${section}`;
    const rootId = task.rootTaskId ?? task.id;
    await saveUserDecision(
      { id: taskId, rootTaskId: rootId },
      { decision: trimmed, approvedAt: Date.now(), source: 'clarification' },
    );
    const labels = (task.labels ?? []).filter(
      (l) => l !== AWAITING_USER_LABEL && l !== AWAITING_PARENT_LABEL,
    );
    const tasks = await orchestrationStore.load('tasks');
    const index = tasks.findIndex((t) => t.id === taskId);
    if (index === -1) return null;
    tasks[index].status = 'todo';
    tasks[index].labels = labels;
    tasks[index].inputContext = inputContext;
    tasks[index].completedAt = undefined;
    tasks[index].checkedOutBy = undefined;
    tasks[index].checkedOutAt = undefined;
    tasks[index].reviewerId = undefined;
    tasks[index].reviewChain = undefined;
    tasks[index].submittedAt = undefined;
    tasks[index].assigneeId = tasks[index].assigneeId ?? tasks[index].submittedById;
    tasks[index].updatedAt = Date.now();
    await orchestrationStore.save('tasks', tasks);
    const saved = normalizeTask(tasks[index]);
    await this.logActivity({
      companyId: saved.companyId,
      actorId: reviewerId,
      actorType: 'human',
      action: 'task:user_clarification_answered',
      entityType: 'task',
      entityId: taskId,
      data: { response: trimmed.slice(0, 500) },
    });
    if (saved.assigneeId) this.emit('task:created', saved);
    console.log(`[Orchestration] User clarification answered for task: ${taskId}`);
    return saved;
  }

  async complete(taskId: string, agentId: string, workProduct?: Partial<WorkProduct>): Promise<Task | null> {
    const task = await this.getTaskById(taskId);
    if (!task) return null;
    const workerId = task.assigneeId ?? agentId;
    const chain = await taskWorkflow.resolveManagementChain(workerId);
    if (chain.length > 0) {
      return this.submitForReview(taskId, agentId, workProduct);
    }
    const updated = await this.updateStatus(taskId, 'done', agentId);
    if (!updated) return null;
    if (workProduct) {
      await taskWorkflow.saveWorkProduct(taskId, agentId, workProduct);
    }
    await taskWorkflow.unblockDependents(taskId);
    if (updated.parentTaskId) {
      await this.tryCompleteDelegatedParent(updated.parentTaskId, agentId);
    }
    console.log(`[Orchestration] Task completed: ${updated.title}`);
    return updated;
  }

  async addComment(taskId: string, authorId: string, authorType: 'agent' | 'human', content: string): Promise<TaskComment> {
    const comments = await orchestrationStore.load('comments');
    const comment: TaskComment = {
      id: generateId(),
      taskId,
      authorId,
      authorType,
      content,
      createdAt: Date.now(),
    };
    comments.push(comment);
    await orchestrationStore.save('comments', comments);
    return comment;
  }

  async getComments(taskId: string): Promise<TaskComment[]> {
    const comments = await orchestrationStore.load('comments');
    return comments.filter(c => c.taskId === taskId).sort((a, b) => a.createdAt - b.createdAt);
  }

  async getWorkProducts(taskId: string): Promise<WorkProduct[]> {
    const products = await orchestrationStore.load('workProducts');
    return products.filter(p => p.taskId === taskId);
  }

  async getByAssignee(agentId: string): Promise<Task[]> {
    const tasks = await this.loadAllTasks();
    return tasks.filter(
      t => t.assigneeId === agentId && t.status !== 'done' && t.status !== 'cancelled',
    );
  }

  async getNextReviewTask(agentId: string): Promise<Task | null> {
    const queue = await taskWorkflow.getReviewQueue(agentId);
    if (queue.length === 0) return null;
    const priorityOrder: TaskPriority[] = ['critical', 'high', 'medium', 'low'];
    queue.sort((a, b) => {
      const pa = priorityOrder.indexOf(a.priority);
      const pb = priorityOrder.indexOf(b.priority);
      if (pa !== pb) return pa - pb;
      return (a.submittedAt ?? a.createdAt) - (b.submittedAt ?? b.createdAt);
    });
    return queue[0];
  }

  async getNextWorkerTask(agentId: string): Promise<Task | null> {
    const resumeTask = await this.getResumeWorkerTask(agentId);
    if (resumeTask) return resumeTask;
    const tasks = await this.getByAssignee(agentId);
    const available: Task[] = [];
    for (const t of tasks) {
      if (t.status !== 'todo' && t.status !== 'backlog') continue;
      if (t.checkedOutBy) continue;
      if (t.labels?.includes(AWAITING_PARENT_LABEL)) continue;
      if (hasAwaitingUserLabel(t.labels)) continue;
      const comments = await this.getComments(t.id);
      if (isAwaitingParentAnswer(t, comments)) continue;
      try {
        await taskWorkflow.canCheckout(t.id, agentId);
        available.push(t);
      } catch {
        continue;
      }
    }
    if (available.length === 0) return null;
    const priorityOrder: TaskPriority[] = ['critical', 'high', 'medium', 'low'];
    available.sort((a, b) => {
      const pa = priorityOrder.indexOf(a.priority);
      const pb = priorityOrder.indexOf(b.priority);
      if (pa !== pb) return pa - pb;
      return a.createdAt - b.createdAt;
    });
    return available[0];
  }

  /** Pick up in-progress work after heartbeat interrupt without requiring re-checkout. */
  private async getResumeWorkerTask(agentId: string): Promise<Task | null> {
    const tasks = await this.getByAssignee(agentId);
    const resumable = tasks.filter((t) => {
      if (t.status !== 'in_progress') return false;
      if (t.checkedOutBy !== agentId) return false;
      if (t.labels?.includes(AWAITING_PARENT_LABEL)) return false;
      if (hasAwaitingUserLabel(t.labels)) return false;
      return true;
    });
    if (resumable.length === 0) return null;
    const priorityOrder: TaskPriority[] = ['critical', 'high', 'medium', 'low'];
    resumable.sort((a, b) => {
      const pa = priorityOrder.indexOf(a.priority);
      const pb = priorityOrder.indexOf(b.priority);
      if (pa !== pb) return pa - pb;
      return (a.checkedOutAt ?? a.updatedAt) - (b.checkedOutAt ?? b.updatedAt);
    });
    return resumable[0];
  }

  /** Parent manager must answer subtask questions even when the parent epic is blocked on subtasks. */
  async getNextParentAnswerDuty(agentId: string): Promise<Task | null> {
    const reviewFirst = await this.getNextReviewTask(agentId);
    if (reviewFirst) return null;
    const assigned = await this.getByAssignee(agentId);
    for (const parentTask of assigned) {
      const pending = await this.listSubtasksAwaitingParentAnswer(parentTask.id);
      if (pending.length > 0) return parentTask;
    }
    const tasks = await this.loadAllTasks();
    for (const subtask of tasks) {
      if (
        !subtask.parentTaskId ||
        subtask.status === 'done' ||
        subtask.status === 'cancelled' ||
        subtask.status === 'review'
      ) {
        continue;
      }
      const comments = await this.getComments(subtask.id);
      if (!getOpenParentQuestion(comments)) continue;
      const managerId = await resolveParentManagerIdWithLookup(
        subtask.assigneeId ?? '',
        subtask,
        (id) => this.getTaskById(id),
      );
      if (managerId !== agentId) continue;
      const parentTask = await this.getTaskById(subtask.parentTaskId);
      if (parentTask) return parentTask;
    }
    return null;
  }

  async getNextTask(
    agentId: string,
  ): Promise<{ task: Task; mode: 'review' | 'work'; answerSubtaskQuestions?: boolean } | null> {
    const reviewTask = await this.getNextReviewTask(agentId);
    if (reviewTask) return { task: reviewTask, mode: 'review' };
    const answerDuty = await this.getNextParentAnswerDuty(agentId);
    if (answerDuty) {
      return { task: answerDuty, mode: 'work', answerSubtaskQuestions: true };
    }
    const workTask = await this.getNextWorkerTask(agentId);
    if (workTask) return { task: workTask, mode: 'work' };
    return null;
  }

  async getDependencyContext(taskId: string): Promise<string> {
    try {
      return await taskWorkflow.buildDependencyContext(taskId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[TaskManager] Dependency context failed for ${taskId}: ${msg}`);
      return '';
    }
  }

  async getGoalHierarchy(taskId: string): Promise<{ task: Task; goal?: Goal; company?: any }> {
    const task = await this.getTaskById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const goal = task.goalId ? await this.getGoalById(task.goalId) : undefined;
    const company = await companyManager.getById(task.companyId);
    return { task, goal, company };
  }

  async delete(taskId: string): Promise<boolean> {
    const tasks = await orchestrationStore.load('tasks');
    const task = tasks.find(t => t.id === taskId);
    if (!task) return false;
    const filtered = tasks
      .filter(t => t.id !== taskId)
      .map((t) => {
        if (!t.blockedBy?.includes(taskId)) return t;
        return {
          ...t,
          blockedBy: t.blockedBy.filter((id) => id !== taskId),
          updatedAt: Date.now(),
        };
      });
    await orchestrationStore.save('tasks', filtered);
    await this.logActivity({
      companyId: task.companyId,
      actorId: 'system',
      actorType: 'human',
      action: 'task:deleted',
      entityType: 'task',
      entityId: taskId,
      data: { title: task.title },
    });
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

export const taskManager = new TaskManager();
