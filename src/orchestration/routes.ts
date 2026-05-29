import { Router } from 'express';
import {
  companyManager,
  agentRegistry,
  taskManager,
  budgetTracker,
  governanceEngine,
  heartbeatScheduler,
  orchestrationStore,
  routineManager,
} from './index';
import { loadHistory, loadPipelineTemplates, runPipeline, type Pipeline } from '../pipeline/pipeline-engine';
import { SkillRegistry } from '../skills/registry';
import { loadApprovedWorkspaceSkills, loadApprovedWorkspaceTemplates } from '../creator/workspace-creator';
import { notifyOrchestrationUpdate } from '../admin/admin-server';

const router = Router();

const SUPPORTED_STEP_TYPES = new Set([
  'ai_task',
  'research',
  'browse',
  'summarize',
  'generate_doc',
  'deliver',
  'save_history',
  'get_system_info',
]);

const TRADING_STEP_TYPE_MAP: Record<string, string> = {
  input_validation: 'ai_task',
  market_data_fetch: 'research',
  technical_analysis: 'ai_task',
  fundamental_analysis: 'ai_task',
  risk_assessment: 'ai_task',
  buy_sell_signal: 'ai_task',
  position_sizing: 'ai_task',
  order_generation: 'ai_task',
  reason_documentation: 'ai_task',
  output_formatting: 'ai_task',
};

function normalizeTemplateStep(
  step: { type: string; config?: Record<string, any> },
  templateName: string,
): { type: string; config: Record<string, any> } {
  const rawType = String(step?.type || '').trim();
  const originalConfig = { ...(step?.config || {}) };
  const detailLevel = String(originalConfig.detail_level || 'full').trim().toLowerCase();
  if (!rawType) {
    return {
      type: 'ai_task',
      config: {
        prompt: `Continue the workflow for "${templateName}" with best effort based on previous context.`,
      },
    };
  }
  if (SUPPORTED_STEP_TYPES.has(rawType)) {
    return { type: rawType, config: originalConfig };
  }
  const mappedType = TRADING_STEP_TYPE_MAP[rawType];
  if (!mappedType) {
    return {
      type: 'ai_task',
      config: {
        prompt: `Execute workflow phase "${rawType}" for template "${templateName}". Use context and config to produce actionable output.\nConfig: ${JSON.stringify(originalConfig)}`,
      },
    };
  }
  if (mappedType === 'research') {
    return {
      type: 'research',
      config: {
        query: originalConfig.query || originalConfig.symbol || originalConfig.ticker || `Market analysis for ${templateName}`,
        max_results: Number(originalConfig.max_results || 5),
        ...originalConfig,
      },
    };
  }
  if (rawType === 'reason_documentation') {
    if (detailLevel === 'summary') {
      return {
        type: 'summarize',
        config: {
          prompt: originalConfig.prompt || `Summarize rationale and recommendation for "${templateName}".`,
          ...originalConfig,
        },
      };
    }
    return {
      type: 'ai_task',
      config: {
        prompt:
          originalConfig.prompt ||
          `Create full reasoning documentation for "${templateName}" using complete prior context. Include risk factors, evidence, and clear recommendation.`,
        ...originalConfig,
      },
    };
  }
  if (rawType === 'output_formatting') {
    return {
      type: 'ai_task',
      config: {
        prompt:
          originalConfig.prompt ||
          `Format the complete prior context as the final response for "${templateName}". Preserve all important details unless detail_level is explicitly summary.`,
        ...originalConfig,
      },
    };
  }
  if (mappedType === 'deliver') {
    const deliverConfig: Record<string, any> = {
      channel: originalConfig.channel || 'history',
      ...originalConfig,
    };
    // Keep pipeline context as the default payload.
    // Only override with an explicit user-provided message.
    if (!Object.prototype.hasOwnProperty.call(originalConfig, 'message')) {
      delete deliverConfig.message;
    }
    return {
      type: 'deliver',
      config: deliverConfig,
    };
  }
  if (mappedType === 'summarize') {
    return {
      type: 'summarize',
      config: {
        prompt: originalConfig.prompt || `Summarize the rationale and recommendation for "${templateName}".`,
        ...originalConfig,
      },
    };
  }
  return {
    type: 'ai_task',
    config: {
      prompt: originalConfig.prompt || `Execute "${rawType}" for template "${templateName}" with this config: ${JSON.stringify(originalConfig)}`,
      ...originalConfig,
    },
  };
}

router.use((req, res, next) => {
  res.on('finish', () => {
    if (req.method === 'GET') return;
    if (res.statusCode >= 400) return;
    notifyOrchestrationUpdate('orchestration');
  });
  next();
});

router.get('/companies', async (_req, res) => {
  try {
    const companies = await companyManager.list();
    res.json({ companies });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/companies', async (req, res) => {
  try {
    const { name, mission, settings } = req.body;
    if (!name || !mission) {
      return res.status(400).json({ error: 'name and mission required' });
    }
    const company = await companyManager.create({ name, mission, settings });
    res.json({ success: true, company });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/companies/:id', async (req, res) => {
  try {
    const company = await companyManager.getById(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json({ company });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/companies/:id', async (req, res) => {
  try {
    const company = await companyManager.update(req.params.id, req.body);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json({ success: true, company });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/companies/:id', async (req, res) => {
  try {
    const ok = await companyManager.delete(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Company not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/companies/:id/agents', async (req, res) => {
  try {
    const agents = await agentRegistry.getByCompany(req.params.id);
    res.json({ agents });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/companies/:id/org-chart', async (req, res) => {
  try {
    const orgChart = await agentRegistry.getOrgChart(req.params.id);
    res.json({
      roots: orgChart.roots,
      children: Object.fromEntries(orgChart.children),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/agents', async (req, res) => {
  try {
    const companyId = req.query.companyId as string | undefined;
    const agents = companyId
      ? await agentRegistry.getByCompany(companyId)
      : await agentRegistry.list();
    res.json({ agents });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/agents', async (req, res) => {
  try {
    const result = await agentRegistry.create(req.body);
    if ('status' in result && result.status === 'pending') {
      res.json({ success: true, approval: result, message: 'Approval required for hire' });
    } else {
      res.json({ success: true, agent: result });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/agents/:id', async (req, res) => {
  try {
    const agent = await agentRegistry.getById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json({ agent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/agents/:id', async (req, res) => {
  try {
    const agent = await agentRegistry.update(req.params.id, req.body);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json({ success: true, agent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/agents/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const agent = await agentRegistry.updateStatus(req.params.id, status);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json({ success: true, agent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/agents/:id/budget', async (req, res) => {
  try {
    const agent = await agentRegistry.updateBudget(req.params.id, req.body);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json({ success: true, agent });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/agents/:id/heartbeat/enable', async (req, res) => {
  try {
    const { intervalMs } = req.body;
    const ok = await heartbeatScheduler.enableHeartbeat(req.params.id, intervalMs);
    if (!ok) return res.status(404).json({ error: 'Agent not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/agents/:id/heartbeat/disable', async (req, res) => {
  try {
    const ok = await heartbeatScheduler.disableHeartbeat(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Agent not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/agents/:id/heartbeat/trigger', async (req, res) => {
  try {
    const result = await heartbeatScheduler.triggerHeartbeat(req.params.id);
    res.json({ success: result.success, result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/agents/:id', async (req, res) => {
  try {
    const ok = await agentRegistry.delete(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Agent not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/goals', async (req, res) => {
  try {
    const companyId = req.query.companyId as string | undefined;
    const goals = await taskManager.listGoals(companyId);
    res.json({ goals });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/goals', async (req, res) => {
  try {
    const goal = await taskManager.createGoal(req.body);
    res.json({ success: true, goal });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/goals/:id', async (req, res) => {
  try {
    const goal = await taskManager.getGoalById(req.params.id);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    res.json({ goal });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tasks', async (req, res) => {
  try {
    const companyId = req.query.companyId as string | undefined;
    const assigneeId = req.query.assigneeId as string | undefined;

    let tasks = await taskManager.listTasks(companyId);
    if (assigneeId) {
      tasks = tasks.filter(t => t.assigneeId === assigneeId);
    }
    res.json({ tasks });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tasks', async (req, res) => {
  try {
    const result = await taskManager.createTask(req.body);
    if ('status' in result && result.status === 'pending') {
      res.json({ success: true, approval: result, message: 'Approval required for task' });
    } else {
      res.json({ success: true, task: result });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tasks/:id', async (req, res) => {
  try {
    const task = await taskManager.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tasks/:id/subtasks', async (req, res) => {
  try {
    const parent = await taskManager.getTaskById(req.params.id);
    if (!parent) return res.status(404).json({ error: 'Task not found' });
    const tasks = await taskManager.getSubtasks(req.params.id);
    res.json({ tasks });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tasks/:id/subtasks', async (req, res) => {
  try {
    const { title, description, priority, assigneeId, createdBy, labels, dueAt, goalId } = req.body;
    if (!title || !description || !createdBy) {
      return res.status(400).json({ error: 'title, description, and createdBy required' });
    }
    const result = await taskManager.createSubtask(req.params.id, {
      title,
      description,
      priority,
      assigneeId,
      createdBy,
      labels,
      dueAt,
      goalId,
    });
    if ('status' in result && result.status === 'pending') {
      res.json({ success: true, approval: result, message: 'Approval required for sub-task' });
    } else {
      res.json({ success: true, task: result });
    }
  } catch (e: any) {
    const status = e.message?.includes('not found') ? 404 : 400;
    res.status(status).json({ error: e.message });
  }
});

router.post('/tasks/:id/checkout', async (req, res) => {
  try {
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    const task = await taskManager.checkout(req.params.id, agentId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/tasks/:id/release', async (req, res) => {
  try {
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    const task = await taskManager.release(req.params.id, agentId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/tasks/:id/complete', async (req, res) => {
  try {
    const { agentId, workProduct } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    const task = await taskManager.complete(req.params.id, agentId, workProduct);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/tasks/:id/status', async (req, res) => {
  try {
    const { status, actorId } = req.body;
    if (!status || !actorId) return res.status(400).json({ error: 'status and actorId required' });
    const task = await taskManager.updateStatus(req.params.id, status, actorId);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tasks/:id/comments', async (req, res) => {
  try {
    const comments = await taskManager.getComments(req.params.id);
    res.json({ comments });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/tasks/:id/comments', async (req, res) => {
  try {
    const { authorId, authorType, content } = req.body;
    if (!authorId || !content) return res.status(400).json({ error: 'authorId and content required' });
    const comment = await taskManager.addComment(req.params.id, authorId, authorType || 'human', content);
    res.json({ success: true, comment });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/tasks/:id', async (req, res) => {
  try {
    const ok = await taskManager.delete(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/routines', async (req, res) => {
  try {
    const companyId = req.query.companyId as string | undefined;
    const routines = await routineManager.list(companyId);
    res.json({ routines });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/routines', async (req, res) => {
  try {
    const result = await routineManager.create(req.body);
    res.json({ success: true, routine: result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/routines/:id/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled boolean required' });
    const routine = await routineManager.toggle(req.params.id, enabled);
    if (!routine) return res.status(404).json({ error: 'Routine not found' });
    res.json({ success: true, routine });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/routines/:id', async (req, res) => {
  try {
    const ok = await routineManager.delete(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Routine not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/budget/agent/:id', async (req, res) => {
  try {
    const sinceTimestamp = req.query.since ? parseInt(req.query.since as string) : undefined;
    const spending = await budgetTracker.getAgentSpending(req.params.id, sinceTimestamp);
    const check = await budgetTracker.checkBudget(req.params.id);
    res.json({ spending, budget: check });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/budget/company/:id', async (req, res) => {
  try {
    const sinceTimestamp = req.query.since ? parseInt(req.query.since as string) : undefined;
    const spending = await budgetTracker.getCompanySpending(req.params.id, sinceTimestamp);
    res.json({ spending });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/approvals', async (req, res) => {
  try {
    const companyId = req.query.companyId as string | undefined;
    const pending = req.query.pending === 'true';

    const approvals = pending
      ? await governanceEngine.listPending(companyId)
      : await governanceEngine.listAll(companyId);
    res.json({ approvals });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/approvals/:id', async (req, res) => {
  try {
    const approval = await governanceEngine.getById(req.params.id);
    if (!approval) return res.status(404).json({ error: 'Approval not found' });
    res.json({ approval });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/approvals/:id/approve', async (req, res) => {
  try {
    const { reviewerId, notes } = req.body;
    if (!reviewerId) return res.status(400).json({ error: 'reviewerId required' });
    const approval = await governanceEngine.approve(req.params.id, reviewerId, notes);
    if (!approval) return res.status(404).json({ error: 'Approval not found or already processed' });
    res.json({ success: true, approval });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/approvals/:id/reject', async (req, res) => {
  try {
    const { reviewerId, notes } = req.body;
    if (!reviewerId) return res.status(400).json({ error: 'reviewerId required' });
    const approval = await governanceEngine.reject(req.params.id, reviewerId, notes);
    if (!approval) return res.status(404).json({ error: 'Approval not found or already processed' });
    res.json({ success: true, approval });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/approvals/request-budget', async (req, res) => {
  try {
    const { agentId, newLimitUSD, requesterId, reason } = req.body;
    if (!agentId || !newLimitUSD || !requesterId || !reason) {
      return res.status(400).json({ error: 'agentId, newLimitUSD, requesterId, and reason required' });
    }
    const approval = await governanceEngine.requestBudgetIncrease(agentId, newLimitUSD, requesterId, reason);
    res.json({ success: true, approval });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/approvals/request-termination', async (req, res) => {
  try {
    const { agentId, requesterId, reason } = req.body;
    if (!agentId || !requesterId || !reason) {
      return res.status(400).json({ error: 'agentId, requesterId, and reason required' });
    }
    const approval = await governanceEngine.requestTermination(agentId, requesterId, reason);
    res.json({ success: true, approval });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/activity', async (req, res) => {
  try {
    const companyId = req.query.companyId as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const activity = await governanceEngine.getActivityLog(companyId, limit);
    res.json({ activity });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/trading/templates', async (_req, res) => {
  try {
    const templates = await loadPipelineTemplates();
    const workspaceTemplates = await loadApprovedWorkspaceTemplates('trading');
    const merged = [...workspaceTemplates, ...templates];
    res.json({ templates: merged });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/trading/runs', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
    const history = await loadHistory();
    res.json({ runs: history.slice(0, Math.max(1, Math.min(limit, 100))) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/trading/skills', async (_req, res) => {
  try {
    const registry = new SkillRegistry();
    await registry.discover();
    const discovered = registry
      .getAllSkills()
      .filter((item) => item.id.startsWith('trading-') || item.category === 'trading')
      .map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category || 'general',
        description: item.description,
        enabled: item.enabled,
        tags: item.tags || [],
      }));
    const workspace = await loadApprovedWorkspaceSkills('trading');
    res.json({ skills: [...workspace, ...discovered] });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/trading/run-template', async (req, res) => {
  try {
    const { templateId, symbols } = req.body;
    if (!templateId) {
      return res.status(400).json({ error: 'templateId required' });
    }
    const templates = await loadPipelineTemplates();
    const workspaceTemplates = await loadApprovedWorkspaceTemplates('trading');
    const template = [...workspaceTemplates, ...templates].find((item) => item.id === templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    if (!Array.isArray(template.steps) || template.steps.length === 0) {
      return res.status(422).json({ error: 'Template has no runnable steps. Add at least one valid step.' });
    }
    const templateSymbols = Array.isArray(symbols) ? symbols.map((s) => String(s).trim()).filter(Boolean) : [];
    const normalizedSteps = template.steps.map((step) =>
      normalizeTemplateStep(step as { type: string; config?: Record<string, any> }, template.name),
    );
    const hasOutputStep = normalizedSteps.some((step) => step.type === 'deliver' || step.type === 'save_history');
    if (!hasOutputStep) {
      normalizedSteps.push({
        type: 'deliver',
        config: {
          channel: 'history',
          scope: `template-${template.id}`,
          chat_title: `Execution / Template: ${template.name}`,
        },
      });
    }
    const pipeline: Pipeline = {
      id: `trading_run_${Date.now()}`,
      name: template.name,
      trigger: 'manual',
      enabled: true,
      createdAt: Date.now(),
      steps: normalizedSteps.map((normalized) => {
        const config = { ...(normalized.config || {}) };
        if (templateSymbols.length > 0) {
          config.symbols = templateSymbols;
          config.symbol = config.symbol || templateSymbols[0];
          if (typeof config.query === 'string') {
            config.query = config.query.replace(/\{\{symbols\}\}/g, templateSymbols.join(', '));
          }
        }
        return {
          type: normalized.type as any,
          config,
        };
      }),
    };
    const result = await runPipeline(pipeline);
    res.json({ success: true, run: result, template });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export function setupOrchestrationRoutes(app: any): void {
  app.use('/orchestration', router);
  console.log('[Orchestration] API routes registered at /orchestration/*');
}
