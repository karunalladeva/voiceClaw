import { TaskType, ModelConfig } from './types';
import { modelRegistry } from './model-registry';
import { createLlmClient } from '../llm/factory';
import type { LlmClient } from '../llm/types';

/** Maps each TaskType to the capability key that qualifies a model for it. */
const TASK_CAPABILITY: Partial<Record<TaskType, keyof import('./types').ModelCapabilities>> = {
  vision: 'vision',
  audio: 'audio',
  video: 'video',
  code: 'code',
  reasoning: 'reasoning',
  function_calling: 'functionCalling',
  embedding: 'embedding',
};

function pickFast(): ModelConfig | undefined {
  return modelRegistry
    .getEnabled()
    .find((m) => (Array.isArray(m.role) ? m.role : [m.role]).includes('fast'));
}

export class ModelRouter {
  private cache = new Map<string, LlmClient>();

  constructor() {
    modelRegistry.on('changed', () => {
      console.log('[ModelRouter] Registry changed — clearing provider cache.');
      this.cache.clear();
    });
  }

  async getModel(task?: TaskType): Promise<LlmClient> {
    let config: ModelConfig | undefined;
    if (task === 'summarize') {
      config = pickFast() ?? modelRegistry.getMaster();
    } else if (task && TASK_CAPABILITY[task]) {
      config = modelRegistry.getBestFor(TASK_CAPABILITY[task]!);
    } else {
      config = modelRegistry.getMaster();
    }
    if (!config) {
      throw new Error(
        '[ModelRouter] No enabled model found. Add at least one model in models-config.json.',
      );
    }
    return this.load(config);
  }

  async getMasterModel(): Promise<LlmClient> {
    return this.getModel();
  }

  async getById(id: string): Promise<LlmClient | null> {
    const config = modelRegistry.getById(id);
    if (!config) return null;
    return this.load(config);
  }

  async getEnabledPairs(): Promise<Array<{ config: ModelConfig; llm: LlmClient }>> {
    const pairs: Array<{ config: ModelConfig; llm: LlmClient }> = [];
    for (const config of modelRegistry.getEnabled()) {
      try {
        const llm = await this.load(config);
        pairs.push({ config, llm });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[ModelRouter] Could not load model "${config.id}": ${message}`);
      }
    }
    return pairs;
  }

  invalidate(id?: string): void {
    if (id) {
      this.cache.delete(id);
    } else {
      this.cache.clear();
    }
  }

  private async load(config: ModelConfig): Promise<LlmClient> {
    const hit = this.cache.get(config.id);
    if (hit) return hit;
    const llm = await createLlmClient(config);
    this.cache.set(config.id, llm);
    console.log(`[ModelRouter] Loaded provider for model: ${config.id} (${config.provider}/${config.model})`);
    return llm;
  }
}

export const modelRouter = new ModelRouter();
