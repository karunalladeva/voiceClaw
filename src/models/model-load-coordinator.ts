import { configManager } from '../config/index';

import { comfyUIClient } from '../services/comfyui-client';

import { getAgentRunContext } from '../agents/agent-run-context';

import { inferenceActivity } from '../utils/inference-activity';

import { DEFAULT_ORG_MODEL_ID } from '../orchestration/agent-normalizer';

import {

  findLocalConfigForModel,

  isLocalProvider,

  SuspendedLocalModel,

  unloadAllRunningLocalModels,

  unloadLocalModel,

  warmLocalModel,

} from './local-model-lifecycle';

import { modelRegistry } from './model-registry';

import type { ModelConfig } from './types';

import {
  resolveMicroRouterModelConfig,
  shouldKeepMicroRouterAlive,
} from '../agents/micro-router-model';



type QueueEntry = {

  resolve: () => void;

};



class ModelLoadCoordinator {

  private queue: QueueEntry[] = [];

  private gpuHandoffQueue: QueueEntry[] = [];

  private activeLocalHolder: string | null = null;

  private residentModelName: string | null = null;

  private residentModelId: string | null = null;

  private gpuHandoffCount = 0;

  private suspendedLocalModels: SuspendedLocalModel[] = [];

  private pipelinePins = new Map<

    string,

    { modelId: string; refCount: number; expiresAt: number }

  >();



  pinPipeline(rootTaskId: string, modelId: string): void {

    const ttlMs = Number(process.env.ORG_PIPELINE_PIN_TTL_MS) || 0;

    const existing = this.pipelinePins.get(rootTaskId);

    if (existing && existing.modelId === modelId) {

      existing.refCount += 1;

      if (ttlMs > 0) existing.expiresAt = Date.now() + ttlMs;

      return;

    }

    this.pipelinePins.set(rootTaskId, {

      modelId,

      refCount: 1,

      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : Number.MAX_SAFE_INTEGER,

    });

    console.log(`[ModelLoadCoordinator] Pinned pipeline ${rootTaskId} → ${modelId}`);

  }



  unpinPipeline(rootTaskId: string): void {

    const pin = this.pipelinePins.get(rootTaskId);

    if (!pin) return;

    pin.refCount -= 1;

    if (pin.refCount <= 0) {

      this.pipelinePins.delete(rootTaskId);

      console.log(`[ModelLoadCoordinator] Unpinned pipeline ${rootTaskId}`);

    }

  }



  private pruneExpiredPins(): void {

    const now = Date.now();

    for (const [id, pin] of this.pipelinePins) {

      if (pin.expiresAt <= now) this.pipelinePins.delete(id);

    }

  }



  private getActivePinnedModelId(): string | undefined {

    this.pruneExpiredPins();

    for (const pin of this.pipelinePins.values()) {

      if (pin.refCount > 0) return pin.modelId;

    }

    return undefined;

  }



  async acquire(modelId: string): Promise<() => Promise<void>> {

    const config = this.resolveConfig(modelId);

    if (!config || !isLocalProvider(config.provider)) {

      return async () => {};

    }

    await this.waitForGpuHandoff();

    await this.waitForTurn();

    this.activeLocalHolder = config.id;

    const targetModel = config.model;

    const routeConfig = resolveMicroRouterModelConfig();
    const keepRouteAlive =
      shouldKeepMicroRouterAlive() &&
      routeConfig != null &&
      config.id === routeConfig.id;
    const keepWarm = config.id === this.getMasterId() || keepRouteAlive;

    if (this.residentModelName && this.residentModelName !== targetModel) {

      const residentConfig = this.residentModelId

        ? this.resolveConfig(this.residentModelId)

        : config;

      if (residentConfig) {

        await this.unloadWithPrepare(residentConfig, this.residentModelName);

      }

      await this.warmWithPrepare(config, targetModel, keepWarm);

    } else if (!this.residentModelName) {

      await this.warmWithPrepare(config, targetModel, keepWarm);

    }

    this.residentModelName = targetModel;

    this.residentModelId = config.id;

    let released = false;

    return async () => {

      if (released) return;

      released = true;

      await this.releaseAfterLocalRun(config);

    };

  }



  private async unloadWithPrepare(config: ModelConfig, modelName: string): Promise<void> {

    await this.prepareForLocalModelLoad();

    await unloadLocalModel(config, modelName);

  }



  private async warmWithPrepare(

    config: ModelConfig,

    modelName: string,

    keepWarm: boolean,

  ): Promise<void> {

    await this.prepareForLocalModelLoad();

    await warmLocalModel(config, modelName, keepWarm);

  }



  private async releaseAfterLocalRun(ranConfig: ModelConfig): Promise<void> {

    const pinnedModelId = this.getActivePinnedModelId();

    if (pinnedModelId) {

      const pinnedConfig = this.resolveConfig(pinnedModelId);

      if (

        pinnedConfig &&

        (ranConfig.id === pinnedModelId || this.residentModelId === pinnedModelId)

      ) {

        this.activeLocalHolder = null;

        this.drainQueue();

        return;

      }

    }

    const master = modelRegistry.getMaster();

    const masterId = master?.id ?? DEFAULT_ORG_MODEL_ID;

    const usedNonMaster =

      ranConfig.id !== masterId && ranConfig.id !== DEFAULT_ORG_MODEL_ID;

    const routePinned =
      shouldKeepMicroRouterAlive() &&
      resolveMicroRouterModelConfig()?.id === ranConfig.id;

    if (usedNonMaster && master && isLocalProvider(master.provider)) {

      if (
        !routePinned &&
        this.residentModelName &&
        this.residentModelName !== master.model
      ) {

        await this.unloadWithPrepare(ranConfig, this.residentModelName);

      }

      await this.warmWithPrepare(master, master.model, true);

      this.residentModelName = master.model;

      this.residentModelId = master.id;

      console.log(`[ModelLoadCoordinator] Restored master model: ${master.id}`);

    }

    this.activeLocalHolder = null;

    this.drainQueue();

  }



  private resolveConfig(modelId: string): ModelConfig | undefined {

    if (modelId === DEFAULT_ORG_MODEL_ID) {

      return modelRegistry.getMaster();

    }

    return modelRegistry.getById(modelId);

  }



  private getMasterId(): string {

    return modelRegistry.getMaster()?.id ?? DEFAULT_ORG_MODEL_ID;

  }



  isGpuHandoffActive(): boolean {

    return this.gpuHandoffCount > 0;

  }



  async prepareForLocalModelLoad(): Promise<void> {

    const comfy = configManager.getConfig().comfyui;

    if (!comfy.enabled || comfy.unloadLocalModelOnGenerate === false) return;

    await comfyUIClient.freeMemory().catch(() => {});

  }



  async suspendForGpuWork(): Promise<void> {

    this.gpuHandoffCount += 1;

    if (this.gpuHandoffCount > 1) return;

    const comfy = configManager.getConfig().comfyui;

    if (comfy.pauseOrchestrationDuringGenerate !== false) {
      const { heartbeatScheduler } = await import('../orchestration/heartbeat-scheduler');
      heartbeatScheduler.setGpuWorkPaused(true);
      const maxWait = Math.max(5000, comfy.orchestrationPauseMaxWaitMs ?? 120_000);
      const callerAgentId = getAgentRunContext()?.orgAgentId;
      const othersIdle = await heartbeatScheduler.waitForOtherHeartbeatsIdle(maxWait, callerAgentId);
      if (!othersIdle) {
        console.warn(
          `[ModelLoadCoordinator] Starting ComfyUI with ${heartbeatScheduler.getRunningHeartbeatCount(callerAgentId)} other heartbeat(s) still active`,
        );
      }
    }

    const pauseMaxWait = Math.max(5000, comfy.orchestrationPauseMaxWaitMs ?? 120_000);
    await this.waitForGpuHandoffBriefPause(pauseMaxWait);

    this.suspendedLocalModels = await unloadAllRunningLocalModels(this.residentModelName);

    this.residentModelName = null;

    this.residentModelId = null;

    console.log(

      `[ModelLoadCoordinator] Suspended local models for GPU handoff` +

        (this.suspendedLocalModels.length > 0

          ? `: ${this.suspendedLocalModels.map((m) => `${m.provider}:${m.modelName}`).join(', ')}`

          : ' (none loaded)'),

    );

  }



  private async resumeOrchestrationAfterGpuWork(): Promise<void> {
    if (configManager.getConfig().comfyui.pauseOrchestrationDuringGenerate === false) return;
    const { heartbeatScheduler } = await import('../orchestration/heartbeat-scheduler');
    heartbeatScheduler.setGpuWorkPaused(false);
  }

  async restoreAfterGpuWork(): Promise<void> {

    if (this.gpuHandoffCount <= 0) return;

    this.gpuHandoffCount -= 1;

    if (this.gpuHandoffCount > 0) return;

    const pinnedModelId = this.getActivePinnedModelId();

    if (pinnedModelId && this.suspendedLocalModels.length > 0) {

      const pinnedConfig = this.resolveConfig(pinnedModelId);

      const pinnedName = pinnedConfig?.model;

      const wasPinnedSuspended =

        pinnedName &&

        pinnedConfig &&

        this.suspendedLocalModels.some(

          (m) => m.modelName === pinnedName && m.provider === pinnedConfig.provider,

        );

      if (wasPinnedSuspended && pinnedConfig) {

        await this.warmWithPrepare(

          pinnedConfig,

          pinnedName,

          pinnedConfig.id === this.getMasterId(),

        );

        this.residentModelName = pinnedName;

        this.residentModelId = pinnedConfig.id;

        this.suspendedLocalModels = [];

        this.drainGpuHandoffQueue();

        console.log(`[ModelLoadCoordinator] Lighter restore (pipeline pin): ${pinnedModelId}`);

        await this.resumeOrchestrationAfterGpuWork();

        return;

      }

    }

    if (this.suspendedLocalModels.length > 0) {

      for (const { baseUrl, modelName, provider } of this.suspendedLocalModels) {

        const config = findLocalConfigForModel(modelName, baseUrl, provider);

        const keepWarm = config ? config.id === this.getMasterId() : true;

        if (config) {

          await this.warmWithPrepare(config, modelName, keepWarm);

          this.residentModelName = modelName;

          this.residentModelId = config.id;

        } else if (provider === 'ollama') {

          await this.warmWithPrepare(

            {

              id: 'restored',

              name: modelName,

              role: 'general',

              provider: 'ollama',

              model: modelName,

              baseUrl,

              enabled: true,

              isMaster: false,

            },

            modelName,

            true,

          );

          this.residentModelName = modelName;

          this.residentModelId = null;

        } else if (provider === 'llamacpp') {

          await this.warmWithPrepare(

            {

              id: 'restored',

              name: modelName,

              role: 'general',

              provider: 'llamacpp',

              model: modelName,

              baseUrl,

              enabled: true,

              isMaster: false,

            },

            modelName,

            true,

          );

          this.residentModelName = modelName;

          this.residentModelId = null;

        }

      }

      console.log(

        `[ModelLoadCoordinator] Restored after GPU handoff: ${this.suspendedLocalModels.map((m) => m.modelName).join(', ')}`,

      );

    } else {

      const master = modelRegistry.getMaster();

      if (master && isLocalProvider(master.provider)) {

        await this.warmWithPrepare(master, master.model, true);

        this.residentModelName = master.model;

        this.residentModelId = master.id;

        console.log(`[ModelLoadCoordinator] Restored master model after GPU handoff: ${master.id}`);

      }

    }

    this.suspendedLocalModels = [];

    this.drainGpuHandoffQueue();

    await this.resumeOrchestrationAfterGpuWork();

  }



  private async waitForGpuHandoff(): Promise<void> {

    if (this.gpuHandoffCount === 0) return;

    await new Promise<void>((resolve) => {

      this.gpuHandoffQueue.push({ resolve });

    });

  }



  private async waitForTurn(): Promise<void> {

    if (!this.activeLocalHolder) return;

    await new Promise<void>((resolve) => {

      this.queue.push({ resolve });

    });

  }



  private async waitForGpuHandoffBriefPause(maxWaitMs: number = 30_000): Promise<void> {

    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {

      const inferenceCount = inferenceActivity.getActiveCount();

      const otherInference = inferenceCount > 1;

      const holderBusy = !!this.activeLocalHolder;

      if (!otherInference && !holderBusy) {

        return;

      }

      if (inferenceCount === 1 && holderBusy) {

        return;

      }

      await new Promise((resolve) => setTimeout(resolve, 250));

    }

    const inferenceCount = inferenceActivity.getActiveCount();

    if (inferenceCount > 1 || this.activeLocalHolder) {

      console.warn(

        `[ModelLoadCoordinator] Proceeding with ComfyUI GPU handoff after ${maxWaitMs}ms (inference=${inferenceCount}, holder=${this.activeLocalHolder ?? 'none'})`,

      );

    }

  }



  private drainQueue(): void {

    const next = this.queue.shift();

    if (next) next.resolve();

  }



  private drainGpuHandoffQueue(): void {

    while (this.gpuHandoffQueue.length > 0) {

      const next = this.gpuHandoffQueue.shift();

      if (next) next.resolve();

    }

  }



  markResidentFromStartup(master: ModelConfig): void {

    this.noteLocalModelInUse(master);

  }



  noteLocalModelInUse(config: ModelConfig): void {

    if (!isLocalProvider(config.provider)) return;

    this.residentModelName = config.model;

    this.residentModelId = config.id;

  }

}



export const modelLoadCoordinator = new ModelLoadCoordinator();

