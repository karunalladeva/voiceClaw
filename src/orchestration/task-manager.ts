import { EventEmitter } from 'events';
import { orchestrationStore, generateId } from './store';
import { companyManager } from './company-manager';
import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskComment,
  WorkProduct,
  Goal,
  ActivityEvent,
  ApprovalRequest,
} from './types';

export interface CreateTaskInput {
  companyId: string;
  goalId?: string;
  parentTaskId?: string;
  title: string;
  description: string;
  priority?: TaskPriority;
  assigneeId?: string;
  createdBy: string;
  labels?: string[];
  dueAt?: number;
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
  async listTasks(companyId?: string): Promise<Task[]> {
    const tasks = await orchestrationStore.load('tasks');
    if (companyId) return tasks.filter(t => t.companyId === companyId);
    return tasks;
  }

  async listGoals(companyId?: string): Promise<Goal[]> {
    const goals = await orchestrationStore.load('goals');
    if (companyId) return goals.filter(g => g.companyId === companyId);
    return goals;
  }

  async getTaskById(id: string): Promise<Task | undefined> {
    const tasks = await orchestrationStore.load('tasks');
    return tasks.find(t => t.id === id);
  }

  async getSubtasks(parentTaskId: string): Promise<Task[]> {
    const tasks = await orchestrationStore.load('tasks');
    return tasks
      .filter((t) => t.parentTaskId === parentTaskId)
      .sort((a, b) => a.createdAt - b.createdAt);
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
    if (input.parentTaskId) {
      const parentTask = await this.getTaskById(input.parentTaskId);
      if (!parentTask) {
        throw new Error(`Parent task not found: ${input.parentTaskId}`);
      }
      if (parentTask.companyId !== input.companyId) {
        throw new Error('Parent task must belong to the same company.');
      }
    }

    const needsApproval =
      company.settings.requireApprovalForHighPriorityTasks &&
      (input.priority === 'critical' || input.priority === 'high');

    const task: Task = {
      id: generateId(),
      companyId: input.companyId,
      goalId: input.goalId,
      parentTaskId: input.parentTaskId,
      title: input.title,
      description: input.description,
      status: needsApproval ? 'backlog' : 'todo',
      priority: input.priority || 'medium',
      assigneeId: input.assigneeId,
      createdBy: input.createdBy,
      labels: input.labels || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dueAt: input.dueAt,
    };

    if (needsApproval) {
      const approval = await this.createTaskApproval(task);
      return approval;
    }

    const tasks = await orchestrationStore.load('tasks');
    tasks.push(task);
    await orchestrationStore.save('tasks', tasks);

    await this.logActivity({
      companyId: input.companyId,
      actorId: input.createdBy,
      actorType: 'human',
      action: 'task:created',
      entityType: 'task',
      entityId: task.id,
      data: { title: task.title, priority: task.priority },
    });

    console.log(`[Orchestration] Task created: ${task.title}`);
    
    if (task.assigneeId) {
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
      goalId: input.goalId ?? parentTask.goalId,
    };
    return this.createTask(subtaskInput);
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
    const tasks = await orchestrationStore.load('tasks');
    const task = tasks.find(t => t.id === taskId);
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

    await orchestrationStore.save('tasks', tasks);

    await this.logActivity({
      companyId: task.companyId,
      actorId: agentId,
      actorType: 'agent',
      action: 'task:checked_out',
      entityType: 'task',
      entityId: taskId,
      data: { title: task.title },
    });

    console.log(`[Orchestration] Task checked out: ${task.title} by ${agentId}`);
    return task;
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

    return task;
  }

  async updateStatus(taskId: string, status: TaskStatus, actorId: string): Promise<Task | null> {
    const tasks = await orchestrationStore.load('tasks');
    const task = tasks.find(t => t.id === taskId);
    if (!task) return null;

    const oldStatus = task.status;
    task.status = status;
    task.updatedAt = Date.now();

    if (status === 'done') {
      task.completedAt = Date.now();
      task.checkedOutBy = undefined;
      task.checkedOutAt = undefined;
    }

    await orchestrationStore.save('tasks', tasks);

    await this.logActivity({
      companyId: task.companyId,
      actorId,
      actorType: 'agent',
      action: 'task:status_changed',
      entityType: 'task',
      entityId: taskId,
      data: { from: oldStatus, to: status },
    });

    return task;
  }

  async complete(taskId: string, agentId: string, workProduct?: Partial<WorkProduct>): Promise<Task | null> {
    const task = await this.updateStatus(taskId, 'done', agentId);
    if (!task) return null;

    if (workProduct) {
      const workProducts = await orchestrationStore.load('workProducts');
      const product: WorkProduct = {
        id: generateId(),
        taskId,
        agentId,
        type: workProduct.type || 'artifact',
        title: workProduct.title || `Output for ${task.title}`,
        content: workProduct.content || '',
        filePath: workProduct.filePath,
        createdAt: Date.now(),
      };
      workProducts.push(product);
      await orchestrationStore.save('workProducts', workProducts);
    }

    console.log(`[Orchestration] Task completed: ${task.title}`);
    return task;
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
    const tasks = await orchestrationStore.load('tasks');
    return tasks.filter(t => t.assigneeId === agentId && t.status !== 'done' && t.status !== 'cancelled');
  }

  async getNextTask(agentId: string): Promise<Task | null> {
    const tasks = await this.getByAssignee(agentId);
    const available = tasks.filter(t => t.status === 'todo' && !t.checkedOutBy);

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

    const filtered = tasks.filter(t => t.id !== taskId);
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
