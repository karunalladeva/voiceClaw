import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { OrgAgent, AgentStatus } from '@/types/orchestration';

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


function AgentNode({ agent, children, onAgentClick, onWakeAgent, onEditStart }: { agent: OrgAgent; children?: React.ReactNode; onAgentClick?: (agent: OrgAgent) => void; onWakeAgent?: (agentId: string) => void; onEditStart?: (agent: OrgAgent) => void }) {
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
              onClick={(e) => { e.stopPropagation(); onEditStart(agent); }}
              className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 rounded text-[10px] font-medium"
              title="Edit Agent"
            >
              Edit
            </button>
          )}
          {onWakeAgent && (
            <button
              onClick={(e) => { e.stopPropagation(); onWakeAgent(agent.id); }}
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
          <div className="mt-2">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Budget</span>
              <span>${agent.budget.spentThisMonthUSD.toFixed(2)} / ${agent.budget.monthlyLimitUSD}</span>
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

export function OrgChart({ agents, companyId, onAgentClick, onCreateAgent, onEditAgent, onWakeAgent }: Props & { onWakeAgent?: (agentId: string) => void }) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<any>('engineer');
  const [newTitle, setNewTitle] = useState('');
  const [reportsTo, setReportsTo] = useState('');

  const [editingAgent, setEditingAgent] = useState<OrgAgent | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<any>('engineer');
  const [editTitle, setEditTitle] = useState('');
  const [editReportsTo, setEditReportsTo] = useState('');

  const startEdit = (agent: OrgAgent) => {
    setEditingAgent(agent);
    setEditName(agent.name);
    setEditRole(agent.role);
    setEditTitle(agent.title);
    setEditReportsTo(agent.reportsTo || '');
    setIsCreating(false);
  };

  const handleEdit = async () => {
    if (editingAgent && editName && onEditAgent) {
      await onEditAgent(editingAgent.id, {
        name: editName,
        role: editRole,
        title: editTitle,
        reportsTo: editReportsTo || undefined,
      });
      setEditingAgent(null);
    }
  };

  const handleCreate = async () => {
    if (newName && onCreateAgent) {
      await onCreateAgent({
        companyId,
        name: newName,
        role: newRole,
        title: newTitle,
        reportsTo: reportsTo || undefined,
        description: 'Agent created via UI',
        adapter: { type: 'voiceclaw', config: {} },
      });
      setIsCreating(false);
      setNewName('');
      setNewTitle('');
      setReportsTo('');
    }
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
      <AgentNode key={agent.id} agent={agent} onAgentClick={onAgentClick} onWakeAgent={onWakeAgent} onEditStart={startEdit}>
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
          onClick={() => setIsCreating(true)}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-md text-xs font-medium transition-colors"
        >
          + Add Agent
        </button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {editingAgent && (
          <div className="mb-6 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
            <h4 className="text-sm font-medium mb-3">Edit Agent: {editingAgent.name}</h4>
            <div className="grid grid-cols-5 gap-4 items-end">
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Agent Name"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Role</label>
                <select
                  value={editRole}
                  onChange={e => setEditRole(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="engineer">Engineer</option>
                  <option value="designer">Designer</option>
                  <option value="analyst">Analyst</option>
                  <option value="assistant">Assistant</option>
                  <option value="ceo">CEO</option>
                  <option value="cto">CTO</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="e.g. Senior Dev"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Reports To</label>
                <select
                  value={editReportsTo}
                  onChange={e => setEditReportsTo(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">None (Root)</option>
                  {agents.filter(a => a.id !== editingAgent.id).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 pb-0.5">
                <button
                  onClick={handleEdit}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
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
          </div>
        )}

        {isCreating && (
          <div className="mb-6 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
            <h4 className="text-sm font-medium mb-3">Add New Agent</h4>
            <div className="grid grid-cols-5 gap-4 items-end">
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="Agent Name"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Role</label>
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="engineer">Engineer</option>
                  <option value="designer">Designer</option>
                  <option value="analyst">Analyst</option>
                  <option value="assistant">Assistant</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="e.g. Senior Dev"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Reports To</label>
                <select
                  value={reportsTo}
                  onChange={e => setReportsTo(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="">None (Root)</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 pb-0.5">
                <button
                  onClick={handleCreate}
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-md text-sm font-medium transition-colors"
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
