import { orchestrationStore, generateId } from './store';
import { agentRegistry } from './agent-registry';
import { taskManager } from './task-manager';
import type { ApprovalRequest, ApprovalStatus, ActivityEvent, OrgAgent, Task } from './types';

export interface BoardUser {
  id: string;
  name: string;
  email?: string;
  createdAt: number;
}

class GovernanceEngine {
  async listPending(companyId?: string): Promise<ApprovalRequest[]> {
    const approvals = await orchestrationStore.load('approvals');
    return approvals.filter(a =>
      a.status === 'pending' && (!companyId || a.companyId === companyId)
    );
  }

  async listAll(companyId?: string): Promise<ApprovalRequest[]> {
    const approvals = await orchestrationStore.load('approvals');
    if (companyId) return approvals.filter(a => a.companyId === companyId);
    return approvals;
  }

  async getById(id: string): Promise<ApprovalRequest | undefined> {
    const approvals = await orchestrationStore.load('approvals');
    return approvals.find(a => a.id === id);
  }

  async approve(id: string, reviewerId: string, notes?: string): Promise<ApprovalRequest | null> {
    const approvals = await orchestrationStore.load('approvals');
    const approval = approvals.find(a => a.id === id);
    if (!approval || approval.status !== 'pending') return null;

    approval.status = 'approved';
    approval.reviewerId = reviewerId;
    approval.reviewedAt = Date.now();
    approval.reviewNotes = notes;

    await orchestrationStore.save('approvals', approvals);

    await this.executeApproval(approval);

    await this.logActivity({
      companyId: approval.companyId,
      actorId: reviewerId,
      actorType: 'human',
      action: 'approval:approved',
      entityType: 'approval',
      entityId: id,
      data: { type: approval.type, title: approval.title },
    });

    console.log(`[Orchestration] Approved: ${approval.title}`);
    return approval;
  }

  async reject(id: string, reviewerId: string, notes?: string): Promise<ApprovalRequest | null> {
    const approvals = await orchestrationStore.load('approvals');
    const approval = approvals.find(a => a.id === id);
    if (!approval || approval.status !== 'pending') return null;

    approval.status = 'rejected';
    approval.reviewerId = reviewerId;
    approval.reviewedAt = Date.now();
    approval.reviewNotes = notes;

    await orchestrationStore.save('approvals', approvals);

    await this.logActivity({
      companyId: approval.companyId,
      actorId: reviewerId,
      actorType: 'human',
      action: 'approval:rejected',
      entityType: 'approval',
      entityId: id,
      data: { type: approval.type, title: approval.title, reason: notes },
    });

    console.log(`[Orchestration] Rejected: ${approval.title}`);
    return approval;
  }

  private async executeApproval(approval: ApprovalRequest): Promise<void> {
    switch (approval.type) {
      case 'hire': {
        const agentData = approval.data.agent as OrgAgent;
        if (agentData) {
          const agents = await agentRegistry.list();
          agentData.status = 'idle';
          agents.push(agentData);
          await orchestrationStore.save('agents', agents);
          console.log(`[Orchestration] Agent activated after approval: ${agentData.name}`);
        }
        break;
      }

      case 'task': {
        const taskData = approval.data.task as Task;
        if (taskData) {
          const tasks = await orchestrationStore.load('tasks');
          taskData.status = 'todo';
          tasks.push(taskData);
          await orchestrationStore.save('tasks', tasks);
          console.log(`[Orchestration] Task activated after approval: ${taskData.title}`);
        }
        break;
      }

      case 'budget': {
        const { agentId, newLimit } = approval.data as { agentId: string; newLimit: number };
        if (agentId && typeof newLimit === 'number') {
          await agentRegistry.updateBudget(agentId, { monthlyLimitUSD: newLimit });
          console.log(`[Orchestration] Budget updated after approval: ${agentId} -> $${newLimit}`);
        }
        break;
      }

      case 'terminate': {
        const { agentId } = approval.data as { agentId: string };
        if (agentId) {
          await agentRegistry.updateStatus(agentId, 'terminated');
          console.log(`[Orchestration] Agent terminated after approval: ${agentId}`);
        }
        break;
      }

      case 'strategy': {
        console.log(`[Orchestration] Strategy approved: ${approval.title}`);
        break;
      }
    }
  }

  async requestBudgetIncrease(
    agentId: string,
    newLimitUSD: number,
    requesterId: string,
    reason: string
  ): Promise<ApprovalRequest> {
    const agent = await agentRegistry.getById(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    const approvals = await orchestrationStore.load('approvals');
    const approval: ApprovalRequest = {
      id: generateId(),
      companyId: agent.companyId,
      type: 'budget',
      requesterId,
      requesterType: 'agent',
      title: `Increase budget for ${agent.name}`,
      description: reason,
      data: {
        agentId,
        currentLimit: agent.budget.monthlyLimitUSD,
        newLimit: newLimitUSD,
      },
      status: 'pending',
      createdAt: Date.now(),
    };

    approvals.push(approval);
    await orchestrationStore.save('approvals', approvals);

    console.log(`[Orchestration] Budget increase requested: ${agent.name} -> $${newLimitUSD}`);
    return approval;
  }

  async requestTermination(
    agentId: string,
    requesterId: string,
    reason: string
  ): Promise<ApprovalRequest> {
    const agent = await agentRegistry.getById(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    const approvals = await orchestrationStore.load('approvals');
    const approval: ApprovalRequest = {
      id: generateId(),
      companyId: agent.companyId,
      type: 'terminate',
      requesterId,
      requesterType: 'human',
      title: `Terminate agent: ${agent.name}`,
      description: reason,
      data: { agentId, agentName: agent.name },
      status: 'pending',
      createdAt: Date.now(),
    };

    approvals.push(approval);
    await orchestrationStore.save('approvals', approvals);

    console.log(`[Orchestration] Termination requested: ${agent.name}`);
    return approval;
  }

  async requestStrategyApproval(
    companyId: string,
    title: string,
    description: string,
    requesterId: string,
    data: Record<string, unknown>
  ): Promise<ApprovalRequest> {
    const approvals = await orchestrationStore.load('approvals');
    const approval: ApprovalRequest = {
      id: generateId(),
      companyId,
      type: 'strategy',
      requesterId,
      requesterType: 'agent',
      title,
      description,
      data,
      status: 'pending',
      createdAt: Date.now(),
    };

    approvals.push(approval);
    await orchestrationStore.save('approvals', approvals);

    console.log(`[Orchestration] Strategy approval requested: ${title}`);
    return approval;
  }

  async getActivityLog(companyId?: string, limit: number = 100): Promise<ActivityEvent[]> {
    const all = await orchestrationStore.getRecentActivity(limit * 2);
    if (companyId) {
      return all.filter(a => a.companyId === companyId).slice(0, limit);
    }
    return all.slice(0, limit);
  }

  private async logActivity(event: Omit<ActivityEvent, 'id' | 'timestamp'>): Promise<void> {
    await orchestrationStore.appendActivity({
      id: generateId(),
      timestamp: Date.now(),
      ...event,
    });
  }
}

export const governanceEngine = new GovernanceEngine();
