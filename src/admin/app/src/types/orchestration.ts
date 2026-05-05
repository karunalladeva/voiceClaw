export type AgentRole = 
  | 'ceo' 
  | 'cto' 
  | 'engineer' 
  | 'designer' 
  | 'marketer' 
  | 'support' 
  | 'analyst'
  | 'researcher'
  | 'assistant'
  | 'custom';

export type AgentStatus = 
  | 'active' 
  | 'idle' 
  | 'paused' 
  | 'terminated' 
  | 'pending_approval';

export type TaskStatus = 
  | 'backlog'
  | 'todo' 
  | 'in_progress' 
  | 'blocked' 
  | 'review' 
  | 'done' 
  | 'cancelled';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Company {
  id: string;
  name: string;
  mission: string;
  createdAt: number;
  settings: CompanySettings;
}

export interface CompanySettings {
  requireApprovalForHires: boolean;
  requireApprovalForBudgetIncrease: boolean;
  requireApprovalForHighPriorityTasks: boolean;
  defaultAgentBudgetUSD: number;
  maxTotalBudgetUSD: number;
}

export interface OrgAgent {
  id: string;
  companyId: string;
  name: string;
  role: AgentRole;
  customRole?: string;
  title: string;
  description: string;
  status: AgentStatus;
  reportsTo?: string;
  permissions: AgentPermissions;
  budget: AgentBudget;
  heartbeat: HeartbeatConfig;
  adapter: AgentAdapter;
  skills: string[];
  createdAt: number;
  lastActiveAt?: number;
}

export interface AgentPermissions {
  canCreateTasks: boolean;
  canAssignTasks: boolean;
  canApproveWork: boolean;
  canHireAgents: boolean;
  canAccessBudget: boolean;
  canModifyGoals: boolean;
  allowedSkills: string[] | 'all';
}

export interface AgentBudget {
  monthlyLimitUSD: number;
  spentThisMonthUSD: number;
  totalSpentUSD: number;
  warningThresholdPercent: number;
  hardStopEnabled: boolean;
  resetDay: number;
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
  schedule?: string;
  lastBeat?: number;
  nextBeat?: number;
}

export interface AgentAdapter {
  type: 'voiceclaw' | 'claude' | 'codex' | 'cursor' | 'bash' | 'http' | 'custom';
  config: Record<string, unknown>;
}

export interface Goal {
  id: string;
  companyId: string;
  parentId?: string;
  title: string;
  description: string;
  targetMetric?: string;
  targetValue?: string;
  deadline?: number;
  status: 'active' | 'achieved' | 'paused' | 'cancelled';
  createdAt: number;
  createdBy: string;
}

export interface Task {
  id: string;
  companyId: string;
  goalId?: string;
  parentTaskId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string;
  createdBy: string;
  checkedOutBy?: string;
  checkedOutAt?: number;
  blockedBy?: string[];
  labels: string[];
  estimatedTokens?: number;
  actualTokens?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  dueAt?: number;
}

export interface ApprovalRequest {
  id: string;
  companyId: string;
  type: 'hire' | 'budget' | 'task' | 'strategy' | 'terminate';
  requesterId: string;
  requesterType: 'agent' | 'human' | 'system';
  title: string;
  description: string;
  data: Record<string, unknown>;
  status: ApprovalStatus;
  reviewerId?: string;
  reviewedAt?: number;
  reviewNotes?: string;
  createdAt: number;
}

export interface ActivityEvent {
  id: string;
  companyId: string;
  actorId: string;
  actorType: 'agent' | 'human' | 'system';
  action: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
  timestamp: number;
}
