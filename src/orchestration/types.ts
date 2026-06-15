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
  requireUserApprovalForCriticalTasks?: boolean;
  maxReworkAttempts?: number;
  defaultAgentBudgetUSD: number;
  maxTotalBudgetUSD: number;
  /** When true AND root has pipeline-mode label, worker subtasks auto-release after submit. Default false. */
  autoReleasePipelineSubtasks?: boolean;
  /** When true AND root has pipeline-mode label, multi-chapter drafting subtasks split into one task per chapter. Default false. */
  splitChapterSubtasks?: boolean;
  /** When true AND root has pipeline-mode label, managers cannot complete without subtasks. Default true. */
  requireDelegationBeforeComplete?: boolean;
}

export type TaskSource = 'user' | 'agent';

export type ReviewDecision =
  | 'approve_escalate'
  | 'approve_release'
  | 'rework'
  | 'reassign'
  | 'escalate_user'
  | 'request_clarification';

export interface SpawnTaskInput {
  title: string;
  description: string;
  assigneeId: string;
  blockedBy?: string[];
  priority?: TaskPriority;
  /** Workflow phase id (e.g. market-research) for blockedAfter resolution. */
  phaseId?: string;
}

export interface ReviewDecisionPayload {
  decision: ReviewDecision;
  notes?: string;
  nextAssigneeId?: string;
  spawnTask?: SpawnTaskInput;
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
  modelId: string;
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
  rootTaskId?: string;
  source?: TaskSource;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string;
  createdBy: string;
  checkedOutBy?: string;
  checkedOutAt?: number;
  blockedBy?: string[];
  reviewerId?: string;
  submittedById?: string;
  submittedAt?: number;
  reviewChain?: string[];
  reworkCount?: number;
  inputContext?: string;
  labels: string[];
  estimatedTokens?: number;
  actualTokens?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  dueAt?: number;
}

export interface TaskComment {
  id: string;
  taskId: string;
  authorId: string;
  authorType: 'agent' | 'human';
  content: string;
  createdAt: number;
}

export interface WorkProduct {
  id: string;
  taskId: string;
  agentId: string;
  type: 'code' | 'document' | 'artifact' | 'report';
  title: string;
  content: string;
  /** Primary deliverable path on disk (relative or absolute). */
  filePath?: string;
  /** Additional asset paths produced by this task (images, chapters, PDFs). */
  assetPaths?: string[];
  createdAt: number;
}

export interface ApprovalRequest {
  id: string;
  companyId: string;
  type: 'hire' | 'budget' | 'task' | 'strategy' | 'terminate' | 'clarification' | 'work_escalation';
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

export interface CostEvent {
  id: string;
  companyId: string;
  agentId: string;
  taskId?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  timestamp: number;
}

export interface ActivityEvent {
  id: string;
  companyId: string;
  actorId: string;
  actorType: 'agent' | 'human' | 'system';
  action: string;
  entityType: 'agent' | 'task' | 'goal' | 'company' | 'approval' | 'budget';
  entityId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export type AgentRunMode = 'work' | 'review' | 'idle';

export interface AgentRunRecord {
  id: string;
  companyId: string;
  agentId: string;
  agentName: string;
  taskId?: string;
  taskTitle?: string;
  mode: AgentRunMode;
  modelId: string;
  prompt: string;
  answer: string;
  success: boolean;
  error?: string;
  durationMs: number;
  createdAt: number;
}

export interface Routine {
  id: string;
  companyId: string;
  name: string;
  description: string;
  assigneeId: string;
  schedule: string;
  enabled: boolean;
  taskTemplate: Partial<Task>;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
}
