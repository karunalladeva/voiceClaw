import { orchestrationStore, generateId } from './store';
import { companyManager } from './company-manager';
import { normalizeOrgAgent, normalizeOrgAgents, DEFAULT_ORG_MODEL_ID } from './agent-normalizer';
import { taskWorkflow, TaskWorkflowError } from './task-workflow';
import type {
  OrgAgent,
  AgentRole,
  AgentStatus,
  AgentPermissions,
  AgentBudget,
  HeartbeatConfig,
  AgentAdapter,
  ActivityEvent,
  ApprovalRequest,
} from './types';

const DEFAULT_PERMISSIONS: AgentPermissions = {
  canCreateTasks: true,
  canAssignTasks: false,
  canApproveWork: false,
  canHireAgents: false,
  canAccessBudget: false,
  canModifyGoals: false,
  allowedSkills: 'all',
};

const DEFAULT_BUDGET: AgentBudget = {
  monthlyLimitUSD: 50,
  spentThisMonthUSD: 0,
  totalSpentUSD: 0,
  warningThresholdPercent: 80,
  hardStopEnabled: true,
  resetDay: 1,
};

/** Default 15s between scheduled heartbeats (override with ORG_HEARTBEAT_INTERVAL_MS). */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

export function getOrgHeartbeatIntervalMs(agentIntervalMs?: number): number {
  const fromEnv = process.env.ORG_HEARTBEAT_INTERVAL_MS;
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10);
    if (Number.isFinite(parsed) && parsed >= 15_000) {
      return parsed;
    }
  }
  return agentIntervalMs && agentIntervalMs >= 15_000
    ? agentIntervalMs
    : DEFAULT_HEARTBEAT_INTERVAL_MS;
}

const DEFAULT_HEARTBEAT: HeartbeatConfig = {
  enabled: true,
  intervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
};

const ROLE_PERMISSIONS: Partial<Record<AgentRole, Partial<AgentPermissions>>> = {
  ceo: {
    canCreateTasks: true,
    canAssignTasks: true,
    canApproveWork: true,
    canHireAgents: true,
    canAccessBudget: true,
    canModifyGoals: true,
  },
  cto: {
    canCreateTasks: true,
    canAssignTasks: true,
    canApproveWork: true,
    canHireAgents: true,
    canAccessBudget: true,
    canModifyGoals: true,
  },
  engineer: {
    canCreateTasks: true,
    canAssignTasks: false,
    canApproveWork: false,
  },
  analyst: {
    canCreateTasks: true,
    canAccessBudget: true,
  },
};

export interface CreateAgentInput {
  companyId: string;
  name: string;
  role: AgentRole;
  customRole?: string;
  title: string;
  description: string;
  reportsTo?: string;
  permissions?: Partial<AgentPermissions>;
  budget?: Partial<AgentBudget>;
  heartbeat?: Partial<HeartbeatConfig>;
  adapter: AgentAdapter;
  modelId?: string;
  skills?: string[];
}

class AgentRegistry {
  async list(): Promise<OrgAgent[]> {
    const agents = await orchestrationStore.load('agents');
    return normalizeOrgAgents(agents);
  }

  async getById(id: string): Promise<OrgAgent | undefined> {
    const agents = await orchestrationStore.load('agents');
    const agent = agents.find(a => a.id === id);
    return agent ? normalizeOrgAgent(agent) : undefined;
  }

  async getByCompany(companyId: string): Promise<OrgAgent[]> {
    const agents = await this.list();
    return agents.filter(a => a.companyId === companyId);
  }

  async getDirectReports(managerId: string): Promise<OrgAgent[]> {
    const agents = await this.list();
    return agents.filter(
      (a) => a.reportsTo === managerId && a.status !== 'terminated' && a.status !== 'pending_approval',
    );
  }

  async getOrgChart(companyId: string): Promise<{ roots: OrgAgent[]; children: Map<string, OrgAgent[]> }> {
    const agents = await this.getByCompany(companyId);
    const children = new Map<string, OrgAgent[]>();
    const roots: OrgAgent[] = [];

    for (const agent of agents) {
      if (agent.reportsTo) {
        const siblings = children.get(agent.reportsTo) || [];
        siblings.push(agent);
        children.set(agent.reportsTo, siblings);
      } else {
        roots.push(agent);
      }
    }

    return { roots, children };
  }

  async create(input: CreateAgentInput): Promise<OrgAgent | ApprovalRequest> {
    const company = await companyManager.getById(input.companyId);
    if (!company) throw new Error(`Company not found: ${input.companyId}`);
    if (input.reportsTo) {
      try {
        await taskWorkflow.validateReportsToAcyclic(input.companyId, input.reportsTo);
      } catch (e) {
        if (e instanceof TaskWorkflowError) throw new Error(e.message);
        throw e;
      }
    }

    const rolePerms = ROLE_PERMISSIONS[input.role] || {};
    const agent: OrgAgent = {
      id: generateId(),
      companyId: input.companyId,
      name: input.name,
      role: input.role,
      customRole: input.customRole,
      title: input.title,
      description: input.description,
      status: company.settings.requireApprovalForHires ? 'pending_approval' : 'idle',
      reportsTo: input.reportsTo,
      permissions: { ...DEFAULT_PERMISSIONS, ...rolePerms, ...input.permissions },
      budget: { ...DEFAULT_BUDGET, monthlyLimitUSD: company.settings.defaultAgentBudgetUSD, ...input.budget },
      heartbeat: { ...DEFAULT_HEARTBEAT, ...input.heartbeat },
      adapter: input.adapter,
      modelId: input.modelId ?? DEFAULT_ORG_MODEL_ID,
      skills: input.skills ?? [],
      createdAt: Date.now(),
    };

    if (company.settings.requireApprovalForHires) {
      const approval = await this.createApproval(agent);
      return approval;
    }

    const agents = await this.list();
    agents.push(agent);
    await orchestrationStore.save('agents', agents);

    await this.logActivity({
      companyId: input.companyId,
      actorId: 'system',
      actorType: 'system',
      action: 'agent:created',
      entityType: 'agent',
      entityId: agent.id,
      data: { name: agent.name, role: agent.role },
    });

    console.log(`[Orchestration] Agent created: ${agent.name} (${agent.role})`);
    return normalizeOrgAgent(agent);
  }

  private async createApproval(agent: OrgAgent): Promise<ApprovalRequest> {
    const approvals = await orchestrationStore.load('approvals');
    const approval: ApprovalRequest = {
      id: generateId(),
      companyId: agent.companyId,
      type: 'hire',
      requesterId: 'system',
      requesterType: 'system',
      title: `Hire ${agent.name} as ${agent.title}`,
      description: agent.description,
      data: { agent },
      status: 'pending',
      createdAt: Date.now(),
    };

    approvals.push(approval);
    await orchestrationStore.save('approvals', approvals);

    console.log(`[Orchestration] Approval required for hiring: ${agent.name}`);
    return approval;
  }

  async update(id: string, updates: Partial<OrgAgent>): Promise<OrgAgent | null> {
    const agents = await orchestrationStore.load('agents');
    const index = agents.findIndex(a => a.id === id);
    if (index === -1) return null;

    const agent = normalizeOrgAgent(agents[index]);
    const oldData = { name: agent.name, role: agent.role, title: agent.title, reportsTo: agent.reportsTo };
    if (updates.reportsTo !== undefined) {
      try {
        await taskWorkflow.validateReportsToAcyclic(
          agent.companyId,
          updates.reportsTo || undefined,
          id,
        );
      } catch (e) {
        if (e instanceof TaskWorkflowError) throw new Error(e.message);
        throw e;
      }
    }
    const merged: OrgAgent = { ...agent, ...updates };
    if (updates.permissions) {
      merged.permissions = { ...agent.permissions, ...updates.permissions };
    }
    if (updates.budget) {
      merged.budget = { ...agent.budget, ...updates.budget };
    }
    if (updates.heartbeat) {
      merged.heartbeat = { ...agent.heartbeat, ...updates.heartbeat };
    }
    const updatedAgent = normalizeOrgAgent(merged);
    agents[index] = updatedAgent;

    await orchestrationStore.save('agents', agents);

    await this.logActivity({
      companyId: agent.companyId,
      actorId: 'system',
      actorType: 'system',
      action: 'agent:updated',
      entityType: 'agent',
      entityId: id,
      data: { from: oldData, to: { name: updatedAgent.name, role: updatedAgent.role, title: updatedAgent.title, reportsTo: updatedAgent.reportsTo } },
    });

    console.log(`[Orchestration] Agent updated: ${updatedAgent.name} (${updatedAgent.role})`);
    return updatedAgent;
  }

  async updateStatus(id: string, status: AgentStatus): Promise<OrgAgent | null> {
    const agents = await this.list();
    const agent = agents.find(a => a.id === id);
    if (!agent) return null;

    const oldStatus = agent.status;
    agent.status = status;
    if (status === 'active') agent.lastActiveAt = Date.now();

    await orchestrationStore.save('agents', agents);

    await this.logActivity({
      companyId: agent.companyId,
      actorId: 'system',
      actorType: 'system',
      action: 'agent:status_changed',
      entityType: 'agent',
      entityId: id,
      data: { from: oldStatus, to: status },
    });

    return agent;
  }

  async updateBudget(id: string, updates: Partial<AgentBudget>): Promise<OrgAgent | null> {
    const agents = await this.list();
    const agent = agents.find(a => a.id === id);
    if (!agent) return null;

    agent.budget = { ...agent.budget, ...updates };
    await orchestrationStore.save('agents', agents);

    return agent;
  }

  async recordSpend(id: string, amountUSD: number): Promise<OrgAgent | null> {
    const agents = await this.list();
    const agent = agents.find(a => a.id === id);
    if (!agent) return null;

    agent.budget.spentThisMonthUSD += amountUSD;
    agent.budget.totalSpentUSD += amountUSD;

    const usagePercent = (agent.budget.spentThisMonthUSD / agent.budget.monthlyLimitUSD) * 100;

    if (agent.budget.hardStopEnabled && usagePercent >= 100) {
      agent.status = 'paused';
      console.log(`[Orchestration] Agent ${agent.name} paused: budget exceeded`);
    } else if (usagePercent >= agent.budget.warningThresholdPercent) {
      console.log(`[Orchestration] Agent ${agent.name} warning: ${usagePercent.toFixed(1)}% of budget used`);
    }

    await orchestrationStore.save('agents', agents);
    return agent;
  }

  async resetMonthlyBudgets(): Promise<number> {
    const agents = await this.list();
    const today = new Date().getDate();
    let resetCount = 0;

    for (const agent of agents) {
      if (agent.budget.resetDay === today && agent.budget.spentThisMonthUSD > 0) {
        agent.budget.spentThisMonthUSD = 0;
        if (agent.status === 'paused') {
          agent.status = 'idle';
        }
        resetCount++;
      }
    }

    if (resetCount > 0) {
      await orchestrationStore.save('agents', agents);
      console.log(`[Orchestration] Reset monthly budgets for ${resetCount} agents`);
    }

    return resetCount;
  }

  async delete(id: string): Promise<boolean> {
    const agents = await this.list();
    const agent = agents.find(a => a.id === id);
    if (!agent) return false;

    const filtered = agents.filter(a => a.id !== id);
    await orchestrationStore.save('agents', filtered);

    await this.logActivity({
      companyId: agent.companyId,
      actorId: 'system',
      actorType: 'human',
      action: 'agent:deleted',
      entityType: 'agent',
      entityId: id,
      data: { name: agent.name },
    });

    return true;
  }

  async getActiveAgents(companyId?: string): Promise<OrgAgent[]> {
    const agents = companyId ? await this.getByCompany(companyId) : await this.list();
    return agents.filter(a => a.status === 'active');
  }

  private async logActivity(event: Omit<ActivityEvent, 'id' | 'timestamp'>): Promise<void> {
    await orchestrationStore.appendActivity({
      id: generateId(),
      timestamp: Date.now(),
      ...event,
    });
  }
}

export const agentRegistry = new AgentRegistry();
