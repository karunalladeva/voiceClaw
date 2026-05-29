import { EventEmitter } from 'events';
import { agentRegistry } from './agent-registry';
import { taskManager } from './task-manager';
import { budgetTracker } from './budget-tracker';
import { orchestrationStore, generateId } from './store';
import type { OrgAgent, Task, ActivityEvent } from './types';

export interface HeartbeatResult {
  agentId: string;
  taskId?: string;
  success: boolean;
  output?: string;
  error?: string;
  tokensUsed?: number;
  durationMs: number;
}

type HeartbeatHandler = (agent: OrgAgent, task: Task | null, context: string) => Promise<string>;

class HeartbeatScheduler extends EventEmitter {
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private handler: HeartbeatHandler | null = null;
  private running = false;

  setHandler(handler: HeartbeatHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const agents = await agentRegistry.list();
    for (const agent of agents) {
      if (agent.heartbeat.enabled && agent.status === 'active') {
        this.scheduleAgent(agent);
      }
    }

    setInterval(() => this.checkSchedules(), 60000);

    taskManager.on('task:created', async (task) => {
      if (!task.assigneeId) return;
      console.log(`[Orchestration] Auto-triggering heartbeat for new task: ${task.title}`);
      try {
        await this.triggerHeartbeat(task.assigneeId);
      } catch (err: any) {
        console.error(`[Orchestration] Auto-trigger failed: ${err.message}`);
      }
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

  private scheduleAgent(agent: OrgAgent): void {
    if (this.intervals.has(agent.id)) {
      clearInterval(this.intervals.get(agent.id)!);
    }

    const interval = setInterval(
      () => this.triggerHeartbeat(agent.id),
      agent.heartbeat.intervalMs
    );

    this.intervals.set(agent.id, interval);
    console.log(`[Orchestration] Scheduled heartbeat for ${agent.name} every ${agent.heartbeat.intervalMs}ms`);
  }

  async triggerHeartbeat(agentId: string): Promise<HeartbeatResult> {
    const startTime = Date.now();
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

    const task = await taskManager.getNextTask(agentId);
    let checkedOutTask: Task | null = null;

    if (task) {
      try {
        checkedOutTask = await taskManager.checkout(task.id, agentId);
      } catch (err: any) {
        console.log(`[Orchestration] Could not checkout task: ${err.message}`);
      }
    }

    const context = await this.buildContext(agent, checkedOutTask);

    await agentRegistry.updateStatus(agentId, 'active');

    let result: HeartbeatResult;

    try {
      if (!this.handler) {
        throw new Error('No heartbeat handler configured');
      }

      const output = await this.handler(agent, checkedOutTask, context);

      if (checkedOutTask) {
        await taskManager.complete(checkedOutTask.id, agentId, {
          type: 'artifact',
          title: `Heartbeat output: ${checkedOutTask.title}`,
          content: output,
        });
      }

      result = {
        agentId,
        taskId: checkedOutTask?.id,
        success: true,
        output,
        durationMs: Date.now() - startTime,
      };

      this.emit('heartbeat:success', result);
    } catch (err: any) {
      if (checkedOutTask) {
        await taskManager.release(checkedOutTask.id, agentId);
      }

      result = {
        agentId,
        taskId: checkedOutTask?.id,
        success: false,
        error: err.message,
        durationMs: Date.now() - startTime,
      };

      this.emit('heartbeat:error', result);
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
  }

  private async buildContext(agent: OrgAgent, task: Task | null): Promise<string> {
    const parts: string[] = [];

    parts.push(`You are ${agent.name}, ${agent.title}.`);
    parts.push(`Role: ${agent.role}`);
    parts.push(`Description: ${agent.description}`);

    if (task) {
      const hierarchy = await taskManager.getGoalHierarchy(task.id);

      if (hierarchy.company) {
        parts.push(`\nCompany Mission: ${hierarchy.company.mission}`);
      }

      if (hierarchy.goal) {
        parts.push(`\nCurrent Goal: ${hierarchy.goal.title}`);
        parts.push(`Goal Description: ${hierarchy.goal.description}`);
      }

      parts.push(`\nAssigned Task: ${task.title}`);
      parts.push(`Task Description: ${task.description}`);
      parts.push(`Priority: ${task.priority}`);
    } else {
      parts.push('\nNo specific task assigned. Check for work or perform routine duties.');
    }

    const budgetCheck = await budgetTracker.checkBudget(agent.id);
    if (budgetCheck.warning) {
      parts.push(`\nBudget Warning: ${budgetCheck.warning}`);
    }

    return parts.join('\n');
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

  async enableHeartbeat(agentId: string, intervalMs: number = 3600000): Promise<boolean> {
    const agents = await agentRegistry.list();
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return false;

    agent.heartbeat.enabled = true;
    agent.heartbeat.intervalMs = intervalMs;
    agent.heartbeat.nextBeat = Date.now() + intervalMs;

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
