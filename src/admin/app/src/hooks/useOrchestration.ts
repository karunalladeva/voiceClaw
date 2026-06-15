import { useState, useEffect, useCallback } from 'react';
import type {
  Company,
  OrgAgent,
  Task,
  Goal,
  ApprovalRequest,
  ActivityEvent,
  AgentRunRecord,
} from '@/types/orchestration';

const API_BASE = '/orchestration';

export interface CapabilitySkillInfo {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category?: string;
}

export function useAgentCapabilities(liveRevision: number = 0) {
  const [skills, setSkills] = useState<CapabilitySkillInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/capabilities`);
      const data = await res.json();
      setSkills(data.skills || []);
    } catch (err) {
      console.error('Failed to fetch capabilities:', err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, liveRevision]);

  return { capabilitySkills: skills, refreshCapabilities: refresh };
}

export function useCompanies(liveRevision: number = 0) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/companies`);
      const data = await res.json();
      setCompanies(data.companies || []);
    } catch (err) {
      console.error('Failed to fetch companies:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, liveRevision]);

  const createCompany = async (name: string, mission: string) => {
    const res = await fetch(`${API_BASE}/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mission }),
    });
    const data = await res.json();
    if (data.company) {
      setCompanies([...companies, data.company]);
    }
    return data;
  };

  const updateCompanySettings = async (
    companyId: string,
    settings: Partial<import('@/types/orchestration').CompanySettings>,
  ) => {
    const res = await fetch(`${API_BASE}/companies/${companyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update company');
    }
    if (data.company) {
      setCompanies((prev) => prev.map((c) => (c.id === companyId ? data.company : c)));
    }
    return data;
  };

  return { companies, loading, refresh, createCompany, updateCompanySettings };
}

export function useOrgAgents(companyId?: string, liveRevision: number = 0) {
  const [agents, setAgents] = useState<OrgAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const url = companyId
        ? `${API_BASE}/agents?companyId=${companyId}`
        : `${API_BASE}/agents`;
      const res = await fetch(url);
      const data = await res.json();
      setAgents(data.agents || []);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    refresh();
  }, [refresh, liveRevision]);

  const createAgent = async (agent: Partial<OrgAgent>) => {
    const res = await fetch(`${API_BASE}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agent),
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: data.error || `Request failed (${res.status})` };
    }
    if (data.agent) {
      setAgents([...agents, data.agent]);
    }
    return data;
  };

  const updateAgent = async (id: string, updates: Partial<OrgAgent>) => {
    const res = await fetch(`${API_BASE}/agents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: data.error || `Request failed (${res.status})` };
    }
    if (data.agent) {
      setAgents(agents.map(a => a.id === id ? data.agent : a));
    }
    return data;
  };

  const triggerHeartbeat = async (agentId: string) => {
    const res = await fetch(`${API_BASE}/agents/${agentId}/heartbeat/trigger`, {
      method: 'POST',
    });
    return await res.json();
  };

  return { agents, loading, refresh, createAgent, updateAgent, triggerHeartbeat };
}

export function useTasks(companyId?: string, liveRevision: number = 0) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const url = companyId
        ? `${API_BASE}/tasks?companyId=${companyId}`
        : `${API_BASE}/tasks`;
      const res = await fetch(url);
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    refresh();
  }, [refresh, liveRevision]);

  const createTask = async (task: Partial<Task> & { blockedBy?: string[] }) => {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });
    const data = await res.json();
    if (data.task) {
      setTasks([...tasks, data.task]);
    }
    return data;
  };

  const updateTask = async (
    taskId: string,
    updates: {
      title?: string;
      description?: string;
      priority?: string;
      status?: string;
      assigneeId?: string | null;
      blockedBy?: string[];
      labels?: string[];
    },
  ) => {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, actorId: 'admin' }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update task');
    }
    if (data.task) {
      setTasks(prev => prev.map(t => (t.id === taskId ? data.task : t)));
    } else {
      await refresh();
    }
    return data;
  };

  const reviewTask = async (
    taskId: string,
    payload: { reviewerId?: string; decision: string; notes?: string; nextAssigneeId?: string },
  ) => {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerId: payload.reviewerId ?? 'admin', ...payload }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Review failed (${res.status})`);
    }
    if (data.task) {
      setTasks(prev => prev.map(t => (t.id === taskId ? data.task : t)));
    } else {
      await refresh();
    }
    return data;
  };

  const fetchWorkProducts = async (taskId: string) => {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/work-products`);
    const data = await res.json();
    return data.workProducts || [];
  };

  const fetchComments = async (taskId: string) => {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/comments`);
    const data = await res.json();
    return data.comments || [];
  };

  const fetchSubtasks = async (taskId: string) => {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/subtasks`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load subtasks');
    return data.tasks || [];
  };

  const fetchPipelineWorkflow = async (taskId: string) => {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/pipeline-workflow`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load pipeline workflow');
    return data as import('@/types/orchestration').PipelineWorkflowInfo;
  };

  const delegateTeam = async (
    taskId: string,
    options?: { supersede?: boolean; managerId?: string },
  ) => {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/delegate-team`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supersede: options?.supersede === true,
        managerId: options?.managerId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Delegation failed');
    await refresh();
    return data;
  };

  const refreshTaskContext = async (taskId: string) => {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/refresh-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Refresh failed');
    if (data.task) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)));
    } else {
      await refresh();
    }
    return data;
  };

  const refreshRootContext = async (rootTaskId: string) => {
    const res = await fetch(`${API_BASE}/tasks/refresh-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootTaskId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bulk refresh failed');
    await refresh();
    return data;
  };

  const requestClarification = async (taskId: string, question: string) => {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/clarifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'admin', question }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Clarification failed');
    if (data.task) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)));
    } else {
      await refresh();
    }
    return data;
  };

  const addTaskComment = async (taskId: string, content: string) => {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorId: 'admin', authorType: 'human', content }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add comment');
    return data.comment;
  };

  const bulkUpdateTaskStatus = async (options: {
    status: string;
    fromStatuses?: string[];
  }) => {
    const res = await fetch(`${API_BASE}/tasks/bulk-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId,
        status: options.status,
        fromStatuses: options.fromStatuses,
        actorId: 'admin',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bulk status update failed');
    await refresh();
    return { count: data.count as number };
  };

  return {
    tasks,
    loading,
    refresh,
    createTask,
    updateTask,
    reviewTask,
    fetchWorkProducts,
    fetchComments,
    fetchSubtasks,
    fetchPipelineWorkflow,
    delegateTeam,
    refreshTaskContext,
    refreshRootContext,
    requestClarification,
    addTaskComment,
    bulkUpdateTaskStatus,
  };
}

export function useGoals(companyId?: string, liveRevision: number = 0) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const url = companyId
        ? `${API_BASE}/goals?companyId=${companyId}`
        : `${API_BASE}/goals`;
      const res = await fetch(url);
      const data = await res.json();
      setGoals(data.goals || []);
    } catch (err) {
      console.error('Failed to fetch goals:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    refresh();
  }, [refresh, liveRevision]);

  return { goals, loading, refresh };
}

export function useApprovals(companyId?: string, liveRevision: number = 0) {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const url = companyId
        ? `${API_BASE}/approvals?pending=true&companyId=${companyId}`
        : `${API_BASE}/approvals?pending=true`;
      const res = await fetch(url);
      const data = await res.json();
      setApprovals(data.approvals || []);
    } catch (err) {
      console.error('Failed to fetch approvals:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    refresh();
  }, [refresh, liveRevision]);

  const approve = async (id: string, reviewerId: string = 'admin', notes?: string) => {
    const res = await fetch(`${API_BASE}/approvals/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerId, notes }),
    });
    const data = await res.json();
    if (data.success) {
      setApprovals(approvals.filter(a => a.id !== id));
    }
    return data;
  };

  const reject = async (id: string, reviewerId: string = 'admin', notes?: string) => {
    const res = await fetch(`${API_BASE}/approvals/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerId, notes }),
    });
    const data = await res.json();
    if (data.success) {
      setApprovals(approvals.filter(a => a.id !== id));
    }
    return data;
  };

  const respondClarification = async (id: string, response: string, reviewerId: string = 'admin') => {
    const res = await fetch(`${API_BASE}/approvals/${id}/clarification-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerId, response }),
    });
    const data = await res.json();
    if (data.success) {
      setApprovals(approvals.filter(a => a.id !== id));
    }
    return data;
  };

  return { approvals, loading, refresh, approve, reject, respondClarification };
}

export function useActivity(companyId?: string, liveRevision: number = 0) {
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const url = companyId
        ? `${API_BASE}/activity?companyId=${companyId}&limit=50`
        : `${API_BASE}/activity?limit=50`;
      const res = await fetch(url);
      const data = await res.json();
      setActivity(data.activity || []);
    } catch (err) {
      console.error('Failed to fetch activity:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    refresh();
  }, [refresh, liveRevision]);

  return { activity, loading, refresh };
}

export function useAgentRuns(
  companyId: string | undefined,
  agentId: string | undefined,
  liveRevision: number = 0,
) {
  const [runs, setRuns] = useState<AgentRunRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!companyId) {
      setRuns([]);
      setLoading(false);
      return;
    }
    try {
      const params = new URLSearchParams({ companyId, limit: '50' });
      if (agentId) params.set('agentId', agentId);
      const res = await fetch(`${API_BASE}/agent-runs?${params}`);
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (err) {
      console.error('Failed to fetch agent runs:', err);
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, agentId]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh, liveRevision]);

  return { runs, loading, refresh };
}

export function useBudget(companyId: string, liveRevision: number = 0) {
  const [spending, setSpending] = useState<{
    totalCostUSD: number;
    byAgent: Record<string, number>;
    byModel: Record<string, number>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/budget/company/${companyId}`);
      const data = await res.json();
      setSpending(data.spending || null);
    } catch (err) {
      console.error('Failed to fetch budget:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (companyId) {
      refresh();
    }
  }, [companyId, refresh, liveRevision]);

  const requestBudget = async (agentId: string, newLimitUSD: number, reason: string) => {
    const res = await fetch(`${API_BASE}/approvals/request-budget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, newLimitUSD, reason, requesterId: 'admin' }),
    });
    return await res.json();
  };

  return { spending, loading, refresh, requestBudget };
}

export function useRoutines(companyId?: string, liveRevision: number = 0) {
  const [routines, setRoutines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const url = companyId
        ? `${API_BASE}/routines?companyId=${companyId}`
        : `${API_BASE}/routines`;
      const res = await fetch(url);
      const data = await res.json();
      setRoutines(data.routines || []);
    } catch (err) {
      console.error('Failed to fetch routines:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    refresh();
  }, [refresh, liveRevision]);

  const createRoutine = async (routine: any) => {
    const res = await fetch(`${API_BASE}/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routine),
    });
    const data = await res.json();
    if (data.routine) {
      setRoutines([...routines, data.routine]);
    }
    return data;
  };

  const toggleRoutine = async (id: string, enabled: boolean) => {
    const res = await fetch(`${API_BASE}/routines/${id}/toggle`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json();
    if (data.routine) {
      setRoutines(routines.map(r => r.id === id ? data.routine : r));
    }
    return data;
  };

  const deleteRoutine = async (id: string) => {
    await fetch(`${API_BASE}/routines/${id}`, {
      method: 'DELETE',
    });
    setRoutines(routines.filter(r => r.id !== id));
  };

  return { routines, loading, refresh, createRoutine, toggleRoutine, deleteRoutine };
}

export interface TradingTemplate {
  id: string;
  name: string;
  category: string;
  description?: string;
}

export interface TradingRun {
  pipelineId: string;
  pipelineName: string;
  ranAt: number;
  success: boolean;
  stepResults: Array<{ type: string; success: boolean; output: string }>;
}

export interface TradingSkillInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  tags: string[];
}

export interface CreatorItemMeta {
  id: string;
  name: string;
  slug: string;
  type: 'skill' | 'mcp' | 'template';
  purpose: string;
  status: 'draft' | 'approved' | 'disabled';
  source: 'generator' | 'manual';
  version: number;
  createdAt: string;
  updatedAt: string;
  lastEditedAt?: string;
  notes?: string;
  relativeDir: string;
}

export interface CreatorItemDetail {
  meta: CreatorItemMeta;
  content: Record<string, string>;
}

export function useTradingAdmin() {
  const [templates, setTemplates] = useState<TradingTemplate[]>([]);
  const [runs, setRuns] = useState<TradingRun[]>([]);
  const [skills, setSkills] = useState<TradingSkillInfo[]>([]);
  const [creatorItems, setCreatorItems] = useState<CreatorItemMeta[]>([]);
  const [creatorPurposes, setCreatorPurposes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [templateRes, runsRes, skillsRes, creatorRes, purposeRes] = await Promise.all([
        fetch(`${API_BASE}/trading/templates`),
        fetch(`${API_BASE}/trading/runs?limit=20`),
        fetch(`${API_BASE}/trading/skills`),
        fetch(`/creator/items`),
        fetch(`/creator/purposes`),
      ]);
      const templateData = await templateRes.json();
      const runData = await runsRes.json();
      const skillData = await skillsRes.json();
      const creatorData = await creatorRes.json();
      const purposeData = await purposeRes.json();
      setTemplates(templateData.templates || []);
      setRuns(runData.runs || []);
      setSkills(skillData.skills || []);
      setCreatorItems(creatorData.items || []);
      setCreatorPurposes(purposeData.purposes || []);
    } catch (err) {
      console.error('Failed to fetch trading admin data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runTemplate = async (templateId: string, symbols: string[]) => {
    const res = await fetch(`${API_BASE}/trading/run-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId, symbols }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        error: data?.error || `Run failed (${res.status})`,
      };
    }
    await refresh();
    return data;
  };

  const checkConflict = async (type: 'skill' | 'mcp' | 'template', name: string, purpose: string) => {
    const res = await fetch('/creator/check-conflict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, name, purpose }),
    });
    return await res.json();
  };

  const generateItems = async (payload: {
    name: string;
    purpose: string;
    prompt: string;
    generate: { skill?: boolean; mcp?: boolean; template?: boolean };
  }) => {
    const res = await fetch('/creator/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    await refresh();
    return data;
  };

  const getCreatorItem = async (type: 'skill' | 'mcp' | 'template', slug: string): Promise<CreatorItemDetail | null> => {
    const res = await fetch(`/creator/items/${type}/${slug}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.item || null;
  };

  const updateCreatorItem = async (type: 'skill' | 'mcp' | 'template', slug: string, payload: {
    name?: string;
    purpose?: string;
    notes?: string;
    content?: string;
  }) => {
    const res = await fetch(`/creator/items/${type}/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    await refresh();
    return data;
  };

  const regenerateCreatorItem = async (type: 'skill' | 'mcp' | 'template', slug: string, prompt: string) => {
    const res = await fetch(`/creator/items/${type}/${slug}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    await refresh();
    return data;
  };

  const setCreatorStatus = async (type: 'skill' | 'mcp' | 'template', slug: string, status: 'draft' | 'approved' | 'disabled') => {
    const res = await fetch(`/creator/items/${type}/${slug}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    await refresh();
    return data;
  };

  const deleteCreatorItem = async (type: 'skill' | 'mcp' | 'template', slug: string) => {
    const res = await fetch(`/creator/items/${type}/${slug}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    await refresh();
    return data;
  };

  return {
    templates,
    runs,
    skills,
    creatorItems,
    creatorPurposes,
    loading,
    refresh,
    runTemplate,
    checkConflict,
    generateItems,
    getCreatorItem,
    updateCreatorItem,
    regenerateCreatorItem,
    setCreatorStatus,
    deleteCreatorItem,
  };
}
