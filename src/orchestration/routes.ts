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

const router = Router();

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

export function setupOrchestrationRoutes(app: any): void {
  app.use('/orchestration', router);
  console.log('[Orchestration] API routes registered at /orchestration/*');
}
