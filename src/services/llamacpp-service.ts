import { spawn, type ChildProcess } from 'child_process';
import { configManager } from '../config/index';
import { modelLoadCoordinator } from '../models/model-load-coordinator';
import { modelRegistry } from '../models/model-registry';
import {
  buildLlamacppServerConfig,
  checkLlamacppServerReachable,
  listLlamacppModels,
  loadLlamacppModel,
  resolveLlamacppBaseUrl,
  unloadLlamacppModel,
  warmLlamacppModel,
  type LlamacppModelInfo,
} from '../models/llamacpp-client';
import type { ModelConfig } from '../models/types';

export interface LlamacppHealth {
  enabled: boolean;
  reachable: boolean;
  baseUrl: string;
  managedProcessRunning: boolean;
  pid: number | null;
  routerMode: boolean;
  loadedModels: string[];
  details?: string;
}

function slugifyModelId(modelName: string): string {
  const base = modelName.replace(/\.gguf$/i, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base.toLowerCase() || 'llamacpp-model';
}

export class LlamacppService {
  private serverProcess: ChildProcess | null = null;

  private getServerConfig(baseUrl?: string): ModelConfig {
    const cfg = configManager.getConfig().llamacpp;
    const config = buildLlamacppServerConfig(baseUrl);
    if (cfg.apiKey) {
      config.auth = { apiKey: cfg.apiKey };
    }
    return config;
  }

  async healthCheck(baseUrl?: string): Promise<LlamacppHealth> {
    const cfg = configManager.getConfig().llamacpp;
    const resolvedBaseUrl = resolveLlamacppBaseUrl(baseUrl);
    const serverConfig = this.getServerConfig(resolvedBaseUrl);
    let reachable = false;
    let loadedModels: string[] = [];
    let details = 'llama.cpp server not reachable.';
    reachable = await checkLlamacppServerReachable(resolvedBaseUrl);
    if (reachable) {
      const models = await listLlamacppModels(serverConfig);
      loadedModels = models
        .filter((m) => m.status === 'loaded' || m.status === 'loading')
        .map((m) => m.id);
      details =
        loadedModels.length > 0
          ? `Server online — ${loadedModels.length} model(s) loaded.`
          : `Server online — ${models.length} model(s) available.`;
    }
    return {
      enabled: cfg.enabled,
      reachable,
      baseUrl: resolvedBaseUrl,
      managedProcessRunning: this.isManagedProcessRunning(),
      pid: this.serverProcess?.pid ?? null,
      routerMode: Boolean(cfg.modelsDir?.trim()),
      loadedModels,
      details,
    };
  }

  async listModels(baseUrl?: string): Promise<LlamacppModelInfo[]> {
    return listLlamacppModels(this.getServerConfig(baseUrl));
  }

  async loadModel(modelName: string, baseUrl?: string): Promise<boolean> {
    const config = this.getServerConfig(baseUrl);
    const ok = await loadLlamacppModel(config, modelName);
    if (ok) {
      modelLoadCoordinator.noteLocalModelInUse({ ...config, model: modelName, id: config.id });
    }
    return ok;
  }

  async unloadModel(modelName: string, baseUrl?: string): Promise<void> {
    await unloadLlamacppModel(this.getServerConfig(baseUrl), modelName);
  }

  async warmModel(modelName: string, baseUrl?: string): Promise<void> {
    const config = this.getServerConfig(baseUrl);
    await warmLlamacppModel({ ...config, model: modelName }, modelName);
    modelLoadCoordinator.noteLocalModelInUse({ ...config, model: modelName, id: config.id });
  }

  async registerModel(options: {
    modelName: string;
    id?: string;
    name?: string;
    setMaster?: boolean;
    baseUrl?: string;
  }): Promise<ModelConfig> {
    const cfg = configManager.getConfig().llamacpp;
    const baseUrl = resolveLlamacppBaseUrl(options.baseUrl);
    const id = options.id?.trim() || slugifyModelId(options.modelName);
    const saved = await modelRegistry.addOrUpdate({
      id,
      name: options.name?.trim() || options.modelName,
      role: options.setMaster ? 'master' : 'general',
      provider: 'llamacpp',
      model: options.modelName,
      baseUrl,
      enabled: true,
      isMaster: Boolean(options.setMaster),
      auth: cfg.apiKey ? { apiKey: cfg.apiKey } : undefined,
      tags: ['local', 'llamacpp'],
      description: 'Registered from llama.cpp admin panel',
    });
    if (options.setMaster) {
      await modelRegistry.setMaster(id);
    }
    return saved;
  }

  async useAsMaster(modelName: string, baseUrl?: string): Promise<ModelConfig> {
    const saved = await this.registerModel({ modelName, setMaster: true, baseUrl });
    await this.warmModel(modelName, baseUrl);
    return saved;
  }

  isManagedProcessRunning(): boolean {
    return Boolean(this.serverProcess && this.serverProcess.exitCode === null && !this.serverProcess.killed);
  }

  async startServer(): Promise<{ pid: number | null; baseUrl: string }> {
    const cfg = configManager.getConfig().llamacpp;
    if (!cfg.manageProcess) {
      throw new Error('Process management is disabled. Start llama-server manually or enable "Manage process".');
    }
    if (!cfg.serverBinary?.trim()) {
      throw new Error('serverBinary is required to start llama-server from admin.');
    }
    if (this.isManagedProcessRunning()) {
      return { pid: this.serverProcess?.pid ?? null, baseUrl: resolveLlamacppBaseUrl() };
    }
    const args: string[] = ['--host', cfg.host || '127.0.0.1', '--port', String(cfg.port || 8080)];
    if (cfg.modelsDir?.trim()) {
      args.push('--models-dir', cfg.modelsDir.trim());
    }
    if (cfg.modelsMax > 0) {
      args.push('--models-max', String(cfg.modelsMax));
    }
    if (cfg.modelsPreset?.trim()) {
      args.push('--models-preset', cfg.modelsPreset.trim());
    }
    if (cfg.noModelsAutoload) {
      args.push('--no-models-autoload');
    }
    if (cfg.ctxSize > 0) {
      args.push('-c', String(cfg.ctxSize));
    }
    if (cfg.nGpuLayers !== 0) {
      args.push('-ngl', String(cfg.nGpuLayers));
    }
    if (cfg.threads > 0) {
      args.push('-t', String(cfg.threads));
    }
    const binary = cfg.serverBinary.trim();
    this.serverProcess = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true,
    });
    this.serverProcess.stdout?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.log(`[LlamaCpp Server] ${line}`);
    });
    this.serverProcess.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.warn(`[LlamaCpp Server] ${line}`);
    });
    this.serverProcess.on('exit', (code) => {
      console.log(`[LlamaCpp Server] Process exited (${code ?? 'unknown'})`);
      this.serverProcess = null;
    });
    await this.waitForServerReady(resolveLlamacppBaseUrl(), 60000);
    return { pid: this.serverProcess?.pid ?? null, baseUrl: resolveLlamacppBaseUrl() };
  }

  async stopServer(): Promise<void> {
    if (!this.serverProcess) return;
    const proc = this.serverProcess;
    this.serverProcess = null;
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
        resolve();
      }, 5000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async waitForServerReady(baseUrl: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await checkLlamacppServerReachable(baseUrl);
      if (ok) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Timed out waiting for llama-server to become reachable.');
  }
}

export const llamacppService = new LlamacppService();
