import type { ModelConfig } from '../models/types';
import { createOllamaClient } from './providers/ollama';
import { createOpenAiCompatibleClient } from './providers/openai-compatible';
import { createAnthropicClient } from './providers/anthropic';
import { createGoogleClient } from './providers/google';
import type { LlmClient } from './types';

export async function createLlmClient(config: ModelConfig): Promise<LlmClient> {
  const { provider, baseUrl } = config;
  switch (provider) {
    case 'ollama':
      return createOllamaClient(config);
    case 'lmstudio':
      return createOpenAiCompatibleClient(config, baseUrl || 'http://localhost:1234/v1');
    case 'llamacpp': {
      const { getLlamacppOpenAiUrl } = await import('../models/llamacpp-client');
      return createOpenAiCompatibleClient(config, getLlamacppOpenAiUrl(config));
    }
    case 'openai':
      return createOpenAiCompatibleClient(config, baseUrl || 'https://api.openai.com/v1');
    case 'deepseek':
      return createOpenAiCompatibleClient(config, baseUrl || 'https://api.deepseek.com/v1');
    case 'custom':
      return createOpenAiCompatibleClient(config, baseUrl);
    case 'anthropic':
      return createAnthropicClient(config);
    case 'google':
      return createGoogleClient(config);
    case 'mistral':
      return createOpenAiCompatibleClient(config, baseUrl || 'https://api.mistral.ai/v1');
    default:
      throw new Error(`[LlmFactory] Unsupported provider: "${provider}"`);
  }
}
