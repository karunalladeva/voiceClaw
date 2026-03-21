import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { TaskType, ModelConfig, ModelCapabilities } from './types';
import { modelRegistry } from './model-registry';
import { createProvider } from './provider-factory';

/** Maps each TaskType to the capability key that qualifies a model for it. */
const TASK_CAPABILITY: Partial<Record<TaskType, keyof ModelCapabilities>> = {
  vision:           'vision',
  audio:            'audio',
  video:            'video',
  code:             'code',
  reasoning:        'reasoning',
  function_calling: 'functionCalling',
  embedding:        'embedding',
  // 'text' and 'summarize' have no specialist capability — fall through to master / fast
};

/** For 'summarize', prefer models tagged as 'fast'. */
function pickFast(): ModelConfig | undefined {
  return modelRegistry
    .getEnabled()
    .find((m) => (Array.isArray(m.role) ? m.role : [m.role]).includes('fast'));
}

// ─────────────────────────────────────────────────────────────────────────────

export class ModelRouter {
  /** LLM instance cache: modelConfig.id → BaseChatModel */
  private cache = new Map<string, BaseChatModel>();

  constructor() {
    // When registry changes (add / remove / master switch) clear cache so
    // next access picks up the new configuration.
    modelRegistry.on('changed', () => {
      console.log('[ModelRouter] Registry changed — clearing provider cache.');
      this.cache.clear();
    });
  }

  /**
   * Return the best LLM for a given task.
   *  • task === undefined or 'text' → master model
   *  • task === 'summarize'         → fast model, else master
   *  • otherwise                    → specialist with that capability, else master
   */
  async getModel(task?: TaskType): Promise<BaseChatModel> {
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
        '[ModelRouter] No enabled model found. Add at least one model in models-config.json.'
      );
    }

    return this.load(config);
  }

  /** Shorthand for the master model. */
  async getMasterModel(): Promise<BaseChatModel> {
    return this.getModel();
  }

  /** Load a model by its registry ID directly. */
  async getById(id: string): Promise<BaseChatModel | null> {
    const config = modelRegistry.getById(id);
    if (!config) return null;
    return this.load(config);
  }

  /** Return config + provider instance for all enabled models (used by skill agents). */
  async getEnabledPairs(): Promise<Array<{ config: ModelConfig; llm: BaseChatModel }>> {
    const pairs: Array<{ config: ModelConfig; llm: BaseChatModel }> = [];
    for (const config of modelRegistry.getEnabled()) {
      try {
        const llm = await this.load(config);
        pairs.push({ config, llm });
      } catch (err: any) {
        console.warn(`[ModelRouter] Could not load model "${config.id}": ${err.message}`);
      }
    }
    return pairs;
  }

  /** Evict one or all cached provider instances (call after config edits). */
  invalidate(id?: string) {
    if (id) {
      this.cache.delete(id);
    } else {
      this.cache.clear();
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async load(config: ModelConfig): Promise<BaseChatModel> {
    const hit = this.cache.get(config.id);
    if (hit) return hit;

    const llm = await createProvider(config);
    this.cache.set(config.id, llm);
    console.log(`[ModelRouter] Loaded provider for model: ${config.id} (${config.provider}/${config.model})`);
    return llm;
  }
}

export const modelRouter = new ModelRouter();
