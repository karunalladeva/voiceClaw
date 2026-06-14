import { HumanMessage } from '@langchain/core/messages';
import { configManager } from '../config/index';
import { isLocalProvider, warmLocalModel } from '../models/local-model-lifecycle';
import { modelRouter } from '../models/model-router';
import { modelRegistry } from '../models/model-registry';
import type { ModelConfig } from '../models/types';

function pickFastModel(): ModelConfig | undefined {
  return modelRegistry.getEnabled().find((m) => {
    const roles = Array.isArray(m.role) ? m.role : m.role ? [m.role] : [];
    return roles.includes('fast');
  });
}

export function resolveMicroRouterModelConfig(): ModelConfig | undefined {
  const agent = configManager.getConfig().agent ?? {};
  const mr = agent.microRouter ?? {};
  if (mr.enabled === false || mr.useLlmFallback === false) return undefined;
  if (mr.modelId?.trim()) {
    return modelRegistry.getById(mr.modelId.trim());
  }
  return pickFastModel() ?? modelRegistry.getMaster();
}

export function shouldKeepMicroRouterAlive(): boolean {
  const mr = configManager.getConfig().agent?.microRouter ?? {};
  if (mr.enabled === false || mr.useLlmFallback === false) return false;
  return mr.keepAlive !== false;
}

let lastWarmedModelId: string | null = null;

export function invalidateMicroRouterModelWarm(): void {
  lastWarmedModelId = null;
}

/** Pre-load route model with Ollama keep_alive=-1 (or equivalent) so LLM fallback stays hot. */
export async function warmMicroRouterModel(force = false): Promise<boolean> {
  if (!shouldKeepMicroRouterAlive()) return false;
  const config = resolveMicroRouterModelConfig();
  if (!config) return false;
  if (!force && lastWarmedModelId === config.id) return true;

  try {
    if (isLocalProvider(config.provider)) {
      const { modelLoadCoordinator } = await import('../models/model-load-coordinator');
      await modelLoadCoordinator.prepareForLocalModelLoad();
      await warmLocalModel(config, config.model, true);
    }
    const llm =
      (await modelRouter.getById(config.id)) ?? (await modelRouter.getModel('summarize'));
    await llm.invoke([new HumanMessage({ content: 'hi' })]);
    lastWarmedModelId = config.id;
    console.log(`[MicroRouter] Route model warm: ${config.id} (keep_alive)`);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[MicroRouter] Route model warm failed: ${msg}`);
    lastWarmedModelId = null;
    return false;
  }
}
