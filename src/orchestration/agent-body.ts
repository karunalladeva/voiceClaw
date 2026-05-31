import { modelRegistry } from '../models/model-registry';
import { SkillRegistry } from '../skills/registry';
import type {
  AgentAdapter,
  AgentRole,
  AgentPermissions,
  AgentBudget,
  HeartbeatConfig,
} from './types';
import { DEFAULT_ORG_MODEL_ID } from './agent-normalizer';

export interface ParsedAgentBody {
  companyId: string;
  name: string;
  role: AgentRole;
  customRole?: string;
  title: string;
  description: string;
  reportsTo?: string;
  modelId: string;
  skills: string[];
  adapter: AgentAdapter;
  permissions?: Partial<AgentPermissions>;
  budget?: Partial<AgentBudget>;
  heartbeat?: Partial<HeartbeatConfig>;
}

export class AgentBodyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentBodyValidationError';
  }
}

export async function parseCreateAgentBody(body: Record<string, unknown>): Promise<ParsedAgentBody> {
  const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const role = body.role as AgentRole;
  const titleRaw = typeof body.title === 'string' ? body.title.trim() : '';
  const title = titleRaw || name;
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const modelId =
    typeof body.modelId === 'string' && body.modelId.trim()
      ? body.modelId.trim()
      : DEFAULT_ORG_MODEL_ID;
  if (!companyId || !name || !role || !description) {
    throw new AgentBodyValidationError('companyId, name, role, and description required');
  }
  const adapter = body.adapter as AgentAdapter | undefined;
  if (!adapter?.type) {
    throw new AgentBodyValidationError('adapter.type required');
  }
  if (modelId !== DEFAULT_ORG_MODEL_ID) {
    const config = modelRegistry.getById(modelId);
    if (!config || !config.enabled) {
      throw new AgentBodyValidationError(`Unknown or disabled model: ${modelId}`);
    }
  }
  const skills = parseSkillsArray(body.skills);
  await validateSkillIds(skills);
  return {
    companyId,
    name,
    role,
    customRole: typeof body.customRole === 'string' ? body.customRole : undefined,
    title,
    description,
    reportsTo: typeof body.reportsTo === 'string' && body.reportsTo ? body.reportsTo : undefined,
    modelId,
    skills,
    adapter,
    permissions:
      body.permissions !== undefined
        ? parsePermissionsPatch(body.permissions)
        : undefined,
    budget: body.budget as Partial<AgentBudget>,
    heartbeat: body.heartbeat as Partial<HeartbeatConfig>,
  };
}

export async function parseUpdateAgentBody(
  body: Record<string, unknown>,
): Promise<Partial<ParsedAgentBody>> {
  const updates: Partial<ParsedAgentBody> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new AgentBodyValidationError('name cannot be empty');
    updates.name = name;
  }
  if (body.role !== undefined) updates.role = body.role as AgentRole;
  if (body.title !== undefined) {
    const titleRaw = typeof body.title === 'string' ? body.title.trim() : '';
    const nameForTitle =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : updates.name;
    const title = titleRaw || nameForTitle || '';
    if (!title) throw new AgentBodyValidationError('title cannot be empty');
    updates.title = title;
  }
  if (body.description !== undefined) {
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description) throw new AgentBodyValidationError('description cannot be empty');
    updates.description = description;
  }
  if (body.modelId !== undefined) {
    const modelId =
      typeof body.modelId === 'string' && body.modelId.trim()
        ? body.modelId.trim()
        : DEFAULT_ORG_MODEL_ID;
    if (modelId !== DEFAULT_ORG_MODEL_ID) {
      const config = modelRegistry.getById(modelId);
      if (!config || !config.enabled) {
        throw new AgentBodyValidationError(`Unknown or disabled model: ${modelId}`);
      }
    }
    updates.modelId = modelId;
  }
  if (body.skills !== undefined) {
    updates.skills = parseSkillsArray(body.skills);
    await validateSkillIds(updates.skills);
  }
  if (body.reportsTo !== undefined) {
    updates.reportsTo =
      typeof body.reportsTo === 'string' && body.reportsTo ? body.reportsTo : undefined;
  }
  if (body.customRole !== undefined) {
    updates.customRole = typeof body.customRole === 'string' ? body.customRole : undefined;
  }
  if (body.permissions !== undefined) {
    updates.permissions = parsePermissionsPatch(body.permissions);
  }
  return updates;
}

function parsePermissionsPatch(value: unknown): Partial<AgentPermissions> {
  if (!value || typeof value !== 'object') {
    throw new AgentBodyValidationError('permissions must be an object');
  }
  const raw = value as Record<string, unknown>;
  const patch: Partial<AgentPermissions> = {};
  const boolKeys = [
    'canCreateTasks',
    'canAssignTasks',
    'canApproveWork',
    'canHireAgents',
    'canAccessBudget',
    'canModifyGoals',
  ] as const;
  for (const key of boolKeys) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'boolean') {
        throw new AgentBodyValidationError(`permissions.${key} must be a boolean`);
      }
      patch[key] = raw[key];
    }
  }
  if (raw.allowedSkills !== undefined) {
    if (raw.allowedSkills === 'all') {
      patch.allowedSkills = 'all';
    } else if (Array.isArray(raw.allowedSkills)) {
      patch.allowedSkills = raw.allowedSkills.filter(
        (id): id is string => typeof id === 'string' && id.trim().length > 0,
      );
    } else {
      throw new AgentBodyValidationError('permissions.allowedSkills must be "all" or string[]');
    }
  }
  return patch;
}

function parseSkillsArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

async function validateSkillIds(skillIds: string[]): Promise<void> {
  if (skillIds.length === 0) return;
  const registry = new SkillRegistry();
  await registry.discover();
  const known = new Set(registry.getAllSkills().map(s => s.id));
  for (const id of skillIds) {
    if (!known.has(id)) {
      throw new AgentBodyValidationError(`Unknown skill id: ${id}`);
    }
  }
}

export async function listCapabilitySkills(): Promise<
  Array<{ id: string; name: string; description: string; enabled: boolean; category?: string }>
> {
  const registry = new SkillRegistry();
  await registry.discover();
  return registry
    .getAllSkills()
    .map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      enabled: s.enabled,
      category: s.id.startsWith('creator-') ? 'creator' : s.category,
    }))
    .sort((a, b) => {
      const aCreator = a.category === 'creator' ? 0 : 1;
      const bCreator = b.category === 'creator' ? 0 : 1;
      if (aCreator !== bCreator) return aCreator - bCreator;
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}
