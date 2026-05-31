import type { AgentPermissions, AgentRole } from '@/types/orchestration';

export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = {
  canCreateTasks: true,
  canAssignTasks: false,
  canApproveWork: false,
  canHireAgents: false,
  canAccessBudget: false,
  canModifyGoals: false,
  allowedSkills: 'all',
};

export const ROLE_PERMISSION_PRESETS: Partial<Record<AgentRole, Partial<AgentPermissions>>> = {
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

export const PERMISSION_LABELS: Array<{
  key: keyof Omit<AgentPermissions, 'allowedSkills'>;
  label: string;
  description: string;
}> = [
  {
    key: 'canCreateTasks',
    label: 'Create tasks',
    description: 'Create subtasks under assigned work',
  },
  {
    key: 'canAssignTasks',
    label: 'Assign tasks',
    description: 'Assign work to other agents (delegation)',
  },
  {
    key: 'canApproveWork',
    label: 'Approve work',
    description: 'Review and approve submitted work',
  },
  {
    key: 'canHireAgents',
    label: 'Hire agents',
    description: 'Request new agents in the org',
  },
  {
    key: 'canAccessBudget',
    label: 'Access budget',
    description: 'View and use budget limits',
  },
  {
    key: 'canModifyGoals',
    label: 'Modify goals',
    description: 'Create or edit company goals',
  },
];

export function permissionsForRole(role: string): AgentPermissions {
  const preset = ROLE_PERMISSION_PRESETS[role as AgentRole];
  return { ...DEFAULT_AGENT_PERMISSIONS, ...preset };
}
