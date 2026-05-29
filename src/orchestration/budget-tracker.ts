import { orchestrationStore, generateId } from './store';
import { agentRegistry } from './agent-registry';
import type { CostEvent, OrgAgent, ActivityEvent } from './types';

const MODEL_COSTS_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
  'gemini-1.5-pro': { input: 0.0035, output: 0.0105 },
  'gemini-1.5-flash': { input: 0.00035, output: 0.00105 },
  'llama3': { input: 0, output: 0 },
  'qwen': { input: 0, output: 0 },
  'mistral': { input: 0, output: 0 },
  'ollama': { input: 0, output: 0 },
};

class BudgetTracker {
  private agentMapping: Map<string, string> = new Map();

  setAgentMapping(sessionId: string, orgAgentId: string): void {
    this.agentMapping.set(sessionId, orgAgentId);
  }

  clearAgentMapping(sessionId: string): void {
    this.agentMapping.delete(sessionId);
  }

  getOrgAgentId(sessionId: string): string | undefined {
    return this.agentMapping.get(sessionId);
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const modelKey = Object.keys(MODEL_COSTS_PER_1K_TOKENS).find(k =>
      model.toLowerCase().includes(k.toLowerCase())
    );

    if (!modelKey) return 0;

    const costs = MODEL_COSTS_PER_1K_TOKENS[modelKey];
    const inputCost = (inputTokens / 1000) * costs.input;
    const outputCost = (outputTokens / 1000) * costs.output;

    return inputCost + outputCost;
  }

  async recordUsage(event: {
    agentId: string;
    companyId: string;
    taskId?: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<CostEvent> {
    const costUSD = this.estimateCost(event.model, event.inputTokens, event.outputTokens);

    const costEvent: CostEvent = {
      id: generateId(),
      companyId: event.companyId,
      agentId: event.agentId,
      taskId: event.taskId,
      provider: event.provider,
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      costUSD,
      timestamp: Date.now(),
    };

    await orchestrationStore.appendCost(costEvent);

    if (costUSD > 0) {
      await agentRegistry.recordSpend(event.agentId, costUSD);
    }

    return costEvent;
  }

  async getAgentSpending(agentId: string, sinceTimestamp?: number): Promise<{
    totalCostUSD: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    byModel: Record<string, { cost: number; input: number; output: number }>;
  }> {
    const costs = await orchestrationStore.getCostsByAgent(agentId, sinceTimestamp);

    let totalCostUSD = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const byModel: Record<string, { cost: number; input: number; output: number }> = {};

    for (const cost of costs) {
      totalCostUSD += cost.costUSD;
      totalInputTokens += cost.inputTokens;
      totalOutputTokens += cost.outputTokens;

      if (!byModel[cost.model]) {
        byModel[cost.model] = { cost: 0, input: 0, output: 0 };
      }
      byModel[cost.model].cost += cost.costUSD;
      byModel[cost.model].input += cost.inputTokens;
      byModel[cost.model].output += cost.outputTokens;
    }

    return { totalCostUSD, totalInputTokens, totalOutputTokens, byModel };
  }

  async getCompanySpending(companyId: string, sinceTimestamp?: number): Promise<{
    totalCostUSD: number;
    byAgent: Record<string, number>;
    byModel: Record<string, number>;
  }> {
    const costs = await orchestrationStore.getCostsByCompany(companyId, sinceTimestamp);

    let totalCostUSD = 0;
    const byAgent: Record<string, number> = {};
    const byModel: Record<string, number> = {};

    for (const cost of costs) {
      totalCostUSD += cost.costUSD;
      byAgent[cost.agentId] = (byAgent[cost.agentId] || 0) + cost.costUSD;
      byModel[cost.model] = (byModel[cost.model] || 0) + cost.costUSD;
    }

    return { totalCostUSD, byAgent, byModel };
  }

  async checkBudget(agentId: string): Promise<{
    canProceed: boolean;
    usagePercent: number;
    remainingUSD: number;
    warning?: string;
  }> {
    const agent = await agentRegistry.getById(agentId);
    if (!agent) {
      return { canProceed: true, usagePercent: 0, remainingUSD: 0 };
    }

    const usagePercent = (agent.budget.spentThisMonthUSD / agent.budget.monthlyLimitUSD) * 100;
    const remainingUSD = agent.budget.monthlyLimitUSD - agent.budget.spentThisMonthUSD;

    if (agent.budget.hardStopEnabled && usagePercent >= 100) {
      return {
        canProceed: false,
        usagePercent,
        remainingUSD: 0,
        warning: `Budget exceeded: $${agent.budget.spentThisMonthUSD.toFixed(2)} / $${agent.budget.monthlyLimitUSD.toFixed(2)}`,
      };
    }

    if (usagePercent >= agent.budget.warningThresholdPercent) {
      return {
        canProceed: true,
        usagePercent,
        remainingUSD,
        warning: `Budget warning: ${usagePercent.toFixed(1)}% used`,
      };
    }

    return { canProceed: true, usagePercent, remainingUSD };
  }

  async getMonthStartTimestamp(): Promise<number> {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }
}

export const budgetTracker = new BudgetTracker();
