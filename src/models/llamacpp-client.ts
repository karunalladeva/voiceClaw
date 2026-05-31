import { configManager } from '../config/index';
import type { ModelConfig } from './types';

export const DEFAULT_LLAMACPP_BASE_URL = 'http://localhost:8080';

export interface LlamacppModelInfo {
  id: string;
  status?: string;
}

export function resolveLlamacppBaseUrl(baseUrlOverride?: string): string {
  if (baseUrlOverride?.trim()) {
    return baseUrlOverride.replace(/\/+$/, '');
  }
  try {
    return configManager.getLlamaCppBaseUrl();
  } catch {
    return (process.env.LLAMACPP_BASE_URL || DEFAULT_LLAMACPP_BASE_URL).replace(/\/+$/, '');
  }
}

export function getLlamacppServerUrl(config: ModelConfig): string {
  return resolveLlamacppBaseUrl(config.baseUrl);
}

export function getLlamacppOpenAiUrl(config: ModelConfig): string {
  const base = getLlamacppServerUrl(config);
  if (base.endsWith('/v1')) return base;
  return `${base}/v1`;
}

export function buildLlamacppServerConfig(baseUrl?: string): ModelConfig {
  return {
    id: '_llamacpp_server',
    name: 'LlamaCpp Server',
    role: 'general',
    provider: 'llamacpp',
    model: '',
    baseUrl: resolveLlamacppBaseUrl(baseUrl),
    enabled: true,
    isMaster: false,
  };
}

export async function checkLlamacppServerReachable(baseUrl: string): Promise<boolean> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  return Boolean(res?.ok);
}

export async function listLlamacppModels(
  config: ModelConfig,
): Promise<LlamacppModelInfo[]> {
  const res = await fetch(`${getLlamacppServerUrl(config)}/models`, {
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { data?: LlamacppModelInfo[] };
  return data.data ?? [];
}

export async function listLoadedLlamacppModelNames(config: ModelConfig): Promise<string[]> {
  const models = await listLlamacppModels(config);
  return models
    .filter((entry) => entry.status === 'loaded' || entry.status === 'loading')
    .map((entry) => entry.id);
}

export async function loadLlamacppModel(
  config: ModelConfig,
  modelName: string,
): Promise<boolean> {
  const res = await fetch(`${getLlamacppServerUrl(config)}/models/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName }),
    signal: AbortSignal.timeout(180000),
  }).catch(() => null);
  if (!res?.ok) {
    if (res?.status === 404) {
      console.warn(
        '[LlamaCpp] /models/load not available — is llama-server running in router mode?',
      );
    } else {
      console.warn(`[LlamaCpp] Failed to load "${modelName}" (${res?.status ?? 'network error'})`);
    }
    return false;
  }
  console.log(`[LlamaCpp] Loaded model: ${modelName}`);
  return true;
}

export async function unloadLlamacppModel(
  config: ModelConfig,
  modelName: string,
): Promise<void> {
  const res = await fetch(`${getLlamacppServerUrl(config)}/models/unload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName }),
    signal: AbortSignal.timeout(60000),
  }).catch(() => null);
  if (!res?.ok && res?.status !== 404) {
    console.warn(`[LlamaCpp] Failed to unload "${modelName}" (${res?.status ?? 'network error'})`);
    return;
  }
  console.log(`[LlamaCpp] Unloaded model: ${modelName}`);
}

export async function unloadAllLoadedLlamacppModels(config: ModelConfig): Promise<string[]> {
  const loaded = await listLoadedLlamacppModelNames(config);
  const fallback = loaded.length > 0 ? loaded : config.model ? [config.model] : [];
  for (const modelName of fallback) {
    await unloadLlamacppModel(config, modelName);
  }
  return fallback;
}

/** Warm model via router load API; optional tiny chat ping when router autoload is disabled. */
export async function warmLlamacppModel(config: ModelConfig, modelName: string): Promise<void> {
  const loaded = await loadLlamacppModel(config, modelName);
  if (!loaded) return;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.auth?.apiKey) headers.Authorization = `Bearer ${config.auth.apiKey}`;
  const cfg = configManager.getConfig().llamacpp;
  if (!config.auth?.apiKey && cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }
  await fetch(`${getLlamacppOpenAiUrl(config)}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  }).catch(() => {});
}
