import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { OrgAgent, AgentStatus } from '@/types/orchestration';
import { useModels } from '@/hooks/useApi';
import { useAgentCapabilities } from '@/hooks/useOrchestration';
import { permissionsForRole } from '@/lib/agentPermissions';
import {
  AgentProfileFields,
  isAgentProfileValid,
  type AgentProfileFormState,
} from './AgentProfileFields';

interface Props {
  agents: OrgAgent[];
  companyId: string;
  onAgentClick?: (agent: OrgAgent) => void;
  onCreateAgent?: (agent: Partial<OrgAgent>) => Promise<any>;
  onEditAgent?: (id: string, updates: Partial<OrgAgent>) => Promise<any>;
}

const statusColors: Record<AgentStatus, string> = {
  active: 'bg-green-500',
  idle: 'bg-blue-500',
  paused: 'bg-yellow-500',
  terminated: 'bg-red-500',
  pending_approval: 'bg-purple-500',
};

const emptyForm = (): AgentProfileFormState => ({
  name: '',
  role: 'engineer',
  title: '',
  reportsTo: '',
  description: '',
  modelId: 'master',
  skills: [],
  permissions: permissionsForRole('engineer'),
});

function AgentNode({
  agent,
  children,
  onAgentClick,
  onWakeAgent,
  onEditStart,
}: {
  agent: OrgAgent;
  children?: React.ReactNode;
  onAgentClick?: (agent: OrgAgent) => void;
  onWakeAgent?: (agentId: string) => void;
  onEditStart?: (agent: OrgAgent) => void;
}) {
  const budgetUsage = (agent.budget.spentThisMonthUSD / agent.budget.monthlyLimitUSD) * 100;

  return (
    <div className="flex flex-col items-center">
      <Card
        className="bg-gray-800/80 border-gray-700 hover:border-gray-600 transition-colors cursor-pointer w-48 relative group"
        onClick={() => onAgentClick?.(agent)}
      >
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1 transition-all">
          {onEditStart && (
            <button
              onClick={e => {
                e.stopPropagation();
                onEditStart(agent);
              }}
              className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 rounded text-[10px] font-medium"
              title="Edit Agent"
            >
              Edit
            </button>
          )}
          {onWakeAgent && (
            <button
              onClick={e => {
                e.stopPropagation();
                onWakeAgent(agent.id);
              }}
              className="px-2 py-0.5 bg-green-600 hover:bg-green-500 rounded text-[10px] font-medium"
              title="Wake Agent (Trigger Heartbeat)"
            >
              Wake
            </button>
          )}
        </div>
        <CardContent className="p-3 pt-8">
          <div className="flex items-center justify-between mb-2">
            <span className={`w-2 h-2 rounded-full ${statusColors[agent.status]}`} />
            <Badge variant="outline" className="text-xs">
              {agent.role}
            </Badge>
          </div>
          <h4 className="font-semibold text-sm truncate">{agent.name}</h4>
          <p className="text-xs text-gray-400 truncate">{agent.title}</p>
          <p className="text-[10px] text-gray-500 truncate mt-0.5">
            {agent.modelId === 'master' ? 'master' : agent.modelId}
            {agent.skills.length > 0 ? ` · ${agent.skills.length} skills` : ''}
          </p>
          <div className="mt-2">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Budget</span>
              <span>
                ${agent.budget.spentThisMonthUSD.toFixed(2)} / ${agent.budget.monthlyLimitUSD}
              </span>
            </div>
            <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  budgetUsage >= 100
                    ? 'bg-red-500'
                    : budgetUsage >= 80
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(budgetUsage, 100)}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
      {children && (
        <div className="mt-4 flex gap-4 justify-center relative">
          <div className="absolute top-0 left-1/2 w-px h-4 bg-gray-600 -translate-x-1/2 -translate-y-full" />
          {children}
        </div>
      )}
    </div>
  );
}

export function OrgChart({
  agents,
  companyId,
  onAgentClick,
  onCreateAgent,
  onEditAgent,
  onWakeAgent,
  liveRevision = 0,
}: Props & { onWakeAgent?: (agentId: string) => void; liveRevision?: number }) {
  const { models } = useModels();
  const { capabilitySkills } = useAgentCapabilities(liveRevision);
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState<AgentProfileFormState>(emptyForm);
  const [editingAgent, setEditingAgent] = useState<OrgAgent | null>(null);
  const [editForm, setEditForm] = useState<AgentProfileFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const startEdit = (agent: OrgAgent) => {
    setEditingAgent(agent);
    setEditForm({
      name: agent.name,
      role: agent.role,
      title: agent.title,
      reportsTo: agent.reportsTo || '',
      description: agent.description,
      modelId: agent.modelId || 'master',
      skills: [...(agent.skills || [])],
      permissions: { ...agent.permissions },
    });
    setIsCreating(false);
  };

  const handleEdit = async () => {
    if (!editingAgent || !isAgentProfileValid(editForm) || !onEditAgent) return;
    setFormError(null);
    const name = editForm.name.trim();
    const result = await onEditAgent(editingAgent.id, {
      name,
      role: editForm.role as OrgAgent['role'],
      title: editForm.title.trim() || name,
      reportsTo: editForm.reportsTo || undefined,
      description: editForm.description.trim(),
      modelId: editForm.modelId,
      skills: editForm.skills,
      permissions: editForm.permissions,
    });
    if (result?.error) {
      setFormError(result.error);
      return;
    }
    setEditingAgent(null);
  };

  const handleCreate = async () => {
    if (!isAgentProfileValid(createForm) || !onCreateAgent) return;
    setFormError(null);
    const name = createForm.name.trim();
    const result = await onCreateAgent({
      companyId,
      name,
      role: createForm.role as OrgAgent['role'],
      title: createForm.title.trim() || name,
      reportsTo: createForm.reportsTo || undefined,
      description: createForm.description.trim(),
      modelId: createForm.modelId,
      skills: createForm.skills,
      permissions: createForm.permissions,
      adapter: { type: 'voiceclaw', config: {} },
    });
    if (result?.error) {
      setFormError(result.error);
      return;
    }
    if (!result?.agent && !result?.approval) {
      setFormError('Failed to create agent');
      return;
    }
    setIsCreating(false);
    setCreateForm(emptyForm());
  };

  const roots = agents.filter(a => !a.reportsTo);
  const childrenMap = new Map<string, OrgAgent[]>();

  agents.forEach(agent => {
    if (agent.reportsTo) {
      const siblings = childrenMap.get(agent.reportsTo) || [];
      siblings.push(agent);
      childrenMap.set(agent.reportsTo, siblings);
    }
  });

  const renderAgent = (agent: OrgAgent): React.ReactNode => {
    const children = childrenMap.get(agent.id);
    return (
      <AgentNode
        key={agent.id}
        agent={agent}
        onAgentClick={onAgentClick}
        onWakeAgent={onWakeAgent}
        onEditStart={startEdit}
      >
        {children && children.length > 0 && (
          <>
            {children.map(child => (
              <div key={child.id} className="relative">
                <div className="absolute top-0 left-1/2 w-px h-4 bg-gray-600 -translate-x-1/2" />
                {renderAgent(child)}
              </div>
            ))}
          </>
        )}
      </AgentNode>
    );
  };

  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Organization Chart</CardTitle>
        <button
          onClick={() => {
            setFormError(null);
            setCreateForm(emptyForm());
            setIsCreating(true);
          }}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-md text-xs font-medium transition-colors"
        >
          + Add Agent
        </button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {formError && (
          <div className="mb-4 p-3 rounded-lg border border-red-800 bg-red-950/40 text-sm text-red-300">
            {formError}
          </div>
        )}
        {editingAgent && (
          <div className="mb-6 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
            <h4 className="text-sm font-medium mb-3">Edit Agent: {editingAgent.name}</h4>
            <AgentProfileFields
              state={editForm}
              onChange={patch => setEditForm(prev => ({ ...prev, ...patch }))}
              agents={agents}
              excludeAgentId={editingAgent.id}
              models={models}
              capabilitySkills={capabilitySkills}
              accent="blue"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleEdit}
                disabled={!isAgentProfileValid(editForm)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
              >
                Update
              </button>
              <button
                onClick={() => setEditingAgent(null)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md text-sm font-medium transition-colors border border-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isCreating && (
          <div className="mb-6 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
            <h4 className="text-sm font-medium mb-3">Add New Agent</h4>
            <AgentProfileFields
              state={createForm}
              onChange={patch => setCreateForm(prev => ({ ...prev, ...patch }))}
              agents={agents}
              models={models}
              capabilitySkills={capabilitySkills}
              accent="green"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleCreate}
                disabled={!isAgentProfileValid(createForm)}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => setIsCreating(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md text-sm font-medium transition-colors border border-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {agents.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No agents in organization</div>
        ) : (
          <div className="flex gap-8 justify-center items-start py-4 min-w-max">
            {roots.map(root => renderAgent(root))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
