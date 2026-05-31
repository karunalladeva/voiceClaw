import type { Model } from '@/types';
import type { AgentPermissions } from '@/types/orchestration';
import {
  DEFAULT_AGENT_PERMISSIONS,
  PERMISSION_LABELS,
  permissionsForRole,
} from '@/lib/agentPermissions';
import { MarkdownField } from './MarkdownField';

export interface CapabilitySkill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category?: string;
}

export interface AgentProfileFormState {
  name: string;
  role: string;
  title: string;
  reportsTo: string;
  description: string;
  modelId: string;
  skills: string[];
  permissions: AgentPermissions;
}

interface Props {
  state: AgentProfileFormState;
  onChange: (patch: Partial<AgentProfileFormState>) => void;
  agents: Array<{ id: string; name: string }>;
  excludeAgentId?: string;
  models: Model[];
  capabilitySkills: CapabilitySkill[];
  accent?: 'green' | 'blue';
}

function modelHint(modelId: string, models: Model[]): string {
  if (modelId === 'master') return 'Uses loaded master model (no VRAM swap)';
  const config = models.find(m => m.id === modelId);
  if (!config) return '';
  if (config.provider === 'ollama' || config.provider === 'lmstudio' || config.provider === 'llamacpp') {
    return 'Local model — may swap GPU (~15–30s); master restored after run';
  }
  return 'Cloud model — no local VRAM swap';
}

export function AgentProfileFields({
  state,
  onChange,
  agents,
  excludeAgentId,
  models,
  capabilitySkills,
  accent = 'green',
}: Props) {
  const ring = accent === 'blue' ? 'focus:ring-blue-500' : 'focus:ring-green-500';
  const enabledModels = models.filter(m => m.enabled);
  const toggleSkill = (skillId: string) => {
    const next = state.skills.includes(skillId)
      ? state.skills.filter(id => id !== skillId)
      : [...state.skills, skillId];
    onChange({ skills: next });
  };

  const togglePermission = (key: keyof Omit<AgentPermissions, 'allowedSkills'>) => {
    onChange({
      permissions: {
        ...state.permissions,
        [key]: !state.permissions[key],
      },
    });
  };

  const applyRolePermissionPreset = (role: string) => {
    onChange({ role, permissions: permissionsForRole(role) });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-4 items-end">
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400">Name</label>
          <input
            type="text"
            value={state.name}
            onChange={e => onChange({ name: e.target.value })}
            className={`w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 ${ring}`}
            placeholder="Agent Name"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400">Role</label>
          <select
            value={state.role}
            onChange={e => applyRolePermissionPreset(e.target.value)}
            className={`w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 ${ring}`}
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
          <label className="text-xs text-gray-400">Title (optional)</label>
          <input
            type="text"
            value={state.title}
            onChange={e => onChange({ title: e.target.value })}
            className={`w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 ${ring}`}
            placeholder="e.g. Senior Dev"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400">Reports To</label>
          <select
            value={state.reportsTo}
            onChange={e => onChange({ reportsTo: e.target.value })}
            className={`w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 ${ring}`}
          >
            <option value="">None (Root)</option>
            {agents
              .filter(a => a.id !== excludeAgentId)
              .map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-gray-400">Model</label>
          <select
            value={state.modelId}
            onChange={e => onChange({ modelId: e.target.value })}
            className={`w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-sm focus:outline-none focus:ring-1 ${ring}`}
          >
            <option value="master">Master (default)</option>
            {enabledModels.map(m => (
              <option key={m.id} value={m.id}>
                {m.name || m.model}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-[11px] text-gray-500 -mt-2">{modelHint(state.modelId, models)}</p>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs text-gray-400">Permissions</label>
          <button
            type="button"
            onClick={() => onChange({ permissions: { ...DEFAULT_AGENT_PERMISSIONS } })}
            className="text-[11px] text-gray-500 hover:text-gray-300 underline"
          >
            Reset defaults
          </button>
        </div>
        <p className="text-[11px] text-gray-500">
          Changing role applies a preset; you can override any checkbox. Managers usually need Assign
          tasks and Approve work.
        </p>
        <div className="rounded-md border border-gray-700 bg-gray-900/80 p-3 grid grid-cols-2 gap-3">
          {PERMISSION_LABELS.map(item => (
            <label
              key={item.key}
              className="flex items-start gap-2 text-xs cursor-pointer"
              title={item.description}
            >
              <input
                type="checkbox"
                checked={Boolean(state.permissions[item.key])}
                onChange={() => togglePermission(item.key)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-gray-200">{item.label}</span>
                <span className="block text-gray-500 text-[10px] leading-snug mt-0.5">
                  {item.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <MarkdownField
        label="Roles & responsibilities"
        value={state.description}
        onChange={description => onChange({ description })}
        placeholder={'## Scope\n- Backend APIs\n- Code review\n- Incident response'}
        minRows={6}
        accent={accent}
      />
      <div className="space-y-2">
        <label className="text-xs text-gray-400">Capabilities (skills)</label>
        <p className="text-[11px] text-gray-500">
          Leave none selected to allow all enabled skills. Creator skills (approved in Creator tab) appear under category creator.
        </p>
        <div className="max-h-40 overflow-y-auto rounded-md border border-gray-700 bg-gray-900/80 p-3 grid grid-cols-2 gap-2">
          {capabilitySkills.length === 0 && (
            <p className="text-xs text-gray-500 col-span-2">No skills discovered yet.</p>
          )}
          {capabilitySkills.map(skill => (
            <label
              key={skill.id}
              className={`flex items-start gap-2 text-xs cursor-pointer ${!skill.enabled ? 'opacity-50' : ''}`}
            >
              <input
                type="checkbox"
                checked={state.skills.includes(skill.id)}
                onChange={() => toggleSkill(skill.id)}
                disabled={!skill.enabled}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-gray-200">{skill.name}</span>
                {skill.category && (
                  <span className="text-gray-500 ml-1">({skill.category})</span>
                )}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export function isAgentProfileValid(state: AgentProfileFormState): boolean {
  return Boolean(state.name.trim() && state.description.trim());
}
