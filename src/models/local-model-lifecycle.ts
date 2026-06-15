import {
  getLlamacppServerUrl,
  listLoadedLlamacppModelNames,
  unloadAllLoadedLlamacppModels,
  unloadLlamacppModel,
  warmLlamacppModel,
} from './llamacpp-client';
import { getOllamaRequestTimeoutMs } from '../utils/ollama-fetch';
import { modelRegistry } from './model-registry';
import type { ModelConfig, ModelProvider } from './types';

export const LOCAL_PROVIDERS = new Set<ModelProvider>(['ollama', 'lmstudio', 'llamacpp']);

export interface SuspendedLocalModel {
  baseUrl: string;
  modelName: string;
  provider: ModelProvider;
}

export function isLocalProvider(provider: ModelProvider): boolean {
  return LOCAL_PROVIDERS.has(provider);
}

export function getLocalBaseUrl(config: ModelConfig): string {
  switch (config.provider) {
    case 'ollama':
      return (config.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    case 'llamacpp':
      return getLlamacppServerUrl(config);
    case 'lmstudio':
      return (config.baseUrl || 'http://localhost:1234').replace(/\/+$/, '');
    default:
      return (config.baseUrl || '').replace(/\/+$/, '');
  }
}

export async function unloadLocalModel(config: ModelConfig, modelName: string): Promise<void> {
  if (config.provider === 'ollama') {
    const baseUrl = getLocalBaseUrl(config);
    await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, keep_alive: 0 }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => {});
    console.log(`[ModelLoadCoordinator] Unloaded Ollama model: ${modelName}`);
    return;
  }
  if (config.provider === 'llamacpp') {
    await unloadLlamacppModel(config, modelName);
  }
}

export async function warmLocalModel(
  config: ModelConfig,
  modelName: string,
  keepWarm: boolean,
): Promise<void> {
  if (config.provider === 'ollama') {
    const baseUrl = getLocalBaseUrl(config);
    const keepAlive = keepWarm ? -1 : 300;
    const warmTimeoutMs = Math.max(120_000, getOllamaRequestTimeoutMs());
    try {
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          prompt: 'hi',
          stream: false,
          keep_alive: keepAlive,
        }),
        signal: AbortSignal.timeout(warmTimeoutMs),
      });
      if (!res.ok) {
        console.warn(
          `[ModelLoadCoordinator] Ollama warm failed for ${modelName}: HTTP ${res.status}`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      console.warn(
        `[ModelLoadCoordinator] Ollama warm ${isTimeout ? 'timed out' : 'failed'} for ${modelName} (${warmTimeoutMs}ms): ${msg}`,
      );
    }
    console.log(`[ModelLoadCoordinator] Warmed Ollama model: ${modelName} (keep_alive=${keepAlive})`);
    return;
  }
  if (config.provider === 'llamacpp') {
    await warmLlamacppModel(config, modelName);
    return;
  }
  if (config.provider === 'lmstudio') {
    console.log(`[ModelLoadCoordinator] LM Studio model "${modelName}" — no explicit warm API`);
  }
}

async function listRunningOllamaModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(5000) }).catch(
    () => null,
  );
  if (!res?.ok) return [];
  const data = (await res.json().catch(() => ({}))) as {
    models?: Array<{ name?: string; model?: string }>;
  };
  const names = new Set<string>();
  for (const entry of data.models ?? []) {
    const name = entry.name ?? entry.model;
    if (name) names.add(name);
  }
  return [...names];
}

export async function unloadAllRunningLocalModels(
  residentModelName: string | null,
): Promise<SuspendedLocalModel[]> {
  const unloaded: SuspendedLocalModel[] = [];
  const seen = new Set<string>();

  for (const model of modelRegistry.getEnabled()) {
    if (!isLocalProvider(model.provider)) continue;
    const baseUrl = getLocalBaseUrl(model);
    const key = `${model.provider}:${baseUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (model.provider === 'ollama') {
      const running = await listRunningOllamaModels(baseUrl);
      const targets = running.length > 0 ? running : residentModelName ? [residentModelName] : [];
      for (const modelName of targets) {
        await unloadLocalModel(model, modelName);
        unloaded.push({ baseUrl, modelName, provider: 'ollama' });
      }
      continue;
    }

    if (model.provider === 'llamacpp') {
      const configForServer = modelRegistry.getEnabled().find(
        (m) => m.provider === 'llamacpp' && getLocalBaseUrl(m) === baseUrl,
      );
      if (!configForServer) continue;
      const loaded = await unloadAllLoadedLlamacppModels(configForServer);
      for (const modelName of loaded) {
        unloaded.push({ baseUrl, modelName, provider: 'llamacpp' });
      }
      continue;
    }
  }

  return unloaded;
}

export function findLocalConfigForModel(
  modelName: string,
  baseUrl: string,
  provider: ModelProvider,
): ModelConfig | undefined {
  const normalized = baseUrl.replace(/\/+$/, '');
  return modelRegistry.getEnabled().find(
    (m) =>
      m.provider === provider &&
      m.model === modelName &&
      getLocalBaseUrl(m) === normalized,
  );
}

export async function listLoadedLocalModelNames(config: ModelConfig): Promise<string[]> {
  if (config.provider === 'ollama') {
    return listRunningOllamaModels(getLocalBaseUrl(config));
  }
  if (config.provider === 'llamacpp') {
    return listLoadedLlamacppModelNames(config);
  }
  return [];
}
