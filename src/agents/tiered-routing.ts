import { configManager } from '../config/index';
import { learningEngine } from './learning-engine';

export type RoutingTier = 'T0' | 'T1' | 'T2';

export interface TierDecision {
  tier: RoutingTier;
  reason: string;
  skipMaster?: boolean;
}

export async function decideRoutingTier(query: string): Promise<TierDecision> {
  if (configManager.getConfig().agent?.context?.tieredRouting?.enabled !== true) {
    return { tier: 'T2', reason: 'tiered routing disabled' };
  }
  const q = query.trim().toLowerCase();
  if (q.length < 4) return { tier: 'T0', reason: 'trivial length', skipMaster: true };
  if (q === 'hi' || q === 'hello' || q === 'hey') return { tier: 'T0', reason: 'greeting', skipMaster: true };
  const macro = await learningEngine.matchMacro(query);
  if (macro) return { tier: 'T0', reason: `macro:${macro.name}`, skipMaster: true };
  if (/^(what time|what date|what day)/.test(q)) return { tier: 'T0', reason: 'datetime rule', skipMaster: true };
  return { tier: 'T2', reason: 'default master path' };
}
