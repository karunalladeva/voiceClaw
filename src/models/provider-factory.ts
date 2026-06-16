import type { LlmClient } from '../llm/types';
import { createLlmClient } from '../llm/factory';
import type { ModelConfig } from './types';

/** @deprecated Use createLlmClient from ../llm/factory */
export async function createProvider(config: ModelConfig): Promise<LlmClient> {
  return createLlmClient(config);
}
