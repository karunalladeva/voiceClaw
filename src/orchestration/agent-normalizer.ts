import type { OrgAgent } from './types';

export const DEFAULT_ORG_MODEL_ID = 'master';

export function normalizeOrgAgent(agent: OrgAgent): OrgAgent {
  return {
    ...agent,
    modelId: agent.modelId ?? DEFAULT_ORG_MODEL_ID,
    skills: agent.skills ?? [],
  };
}

export function normalizeOrgAgents(agents: OrgAgent[]): OrgAgent[] {
  return agents.map(normalizeOrgAgent);
}
