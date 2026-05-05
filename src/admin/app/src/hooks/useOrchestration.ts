import { useState, useEffect, useCallback } from 'react';
import type {
  Company,
  OrgAgent,
  Task,
  Goal,
  ApprovalRequest,
  ActivityEvent,
} from '@/types/orchestration';

const API_BASE = '/orchestration';

export function useCompanies() {
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
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

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

  return { companies, loading, refresh, createCompany };
}

export function useOrgAgents(companyId?: string) {
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
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const createAgent = async (agent: Partial<OrgAgent>) => {
    const res = await fetch(`${API_BASE}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agent),
    });
    const data = await res.json();
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

export function useTasks(companyId?: string) {
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
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const createTask = async (task: Partial<Task>) => {
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

  return { tasks, loading, refresh, createTask };
}

export function useGoals(companyId?: string) {
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
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { goals, loading, refresh };
}

export function useApprovals(companyId?: string) {
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
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

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

  return { approvals, loading, refresh, approve, reject };
}

export function useActivity(companyId?: string) {
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
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { activity, loading, refresh };
}

export function useBudget(companyId: string) {
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
      const interval = setInterval(refresh, 30000);
      return () => clearInterval(interval);
    }
  }, [companyId, refresh]);

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

export function useRoutines(companyId?: string) {
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
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

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
