import { exec } from 'child_process';
import { promisify } from 'util';
import { modelRegistry } from '../models/model-registry';
import { orchestrationStore } from '../orchestration/store';
import { cache } from './cache';
import { inferenceActivity } from './inference-activity';

const execAsync = promisify(exec);

export class VramMonitor {
  private interval: NodeJS.Timeout | null = null;
  private idleTimeout: NodeJS.Timeout | null = null;
  private readonly IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  startMonitoring() {
    this.interval = setInterval(async () => {
      try {
        const { stdout } = await execAsync('nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits');
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
           const [usedStr, totalStr] = line.split(',').map(s => s.trim());
           const used = parseInt(usedStr, 10);
           const total = parseInt(totalStr, 10);
           if (total > 0 && (used / total) > 0.90) {
            if (inferenceActivity.hasActiveInference()) {
              console.warn(`[VRAM Monitor] VRAM > 90% but ${inferenceActivity.getActiveCount()} inference task(s) active. Skipping model kill.`);
              continue;
            }
            const hasActiveTasks = await this.hasActiveTaskProcess();
            if (hasActiveTasks) {
              console.warn('[VRAM Monitor] VRAM > 90% but active task process detected. Skipping model kill.');
              continue;
            }
            console.warn('[VRAM Monitor] VRAM usage exceeded 90%. Purging caches and unloading models...');
            await this.purgeCachesAndUnloadModels();
           }
        }
      } catch (err) {
        // nvidia-smi not available or other error
      }
    }, 60000); // Check every minute
  }

  stopMonitoring() {
    if (this.interval) clearInterval(this.interval);
    if (this.idleTimeout) clearTimeout(this.idleTimeout);
  }

  // To be called when the system registers user activity
  registerActivity() {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
    }
    this.idleTimeout = setTimeout(() => {
      console.log('[VRAM Monitor] System idle for 5 minutes. Unloading local models to free VRAM.');
      this.unloadLocalModels();
    }, this.IDLE_THRESHOLD_MS);
  }

  async unloadLocalModels() {
     try {
       const enabledModels = modelRegistry.getEnabled();
       let unloadedCount = 0;
       
       for (const model of enabledModels) {
         if (model.provider === 'ollama' && model.baseUrl) {
            await fetch(`${model.baseUrl}/api/generate`, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ model: model.model, keep_alive: 0 })
            }).catch(() => {});
            unloadedCount++;
         }
         // LMStudio unloads via TTL natively, but if it gains an unload API, add here.
       }
       
       if (unloadedCount > 0) {
         console.log(`[VRAM Monitor] Successfully issued unload commands to ${unloadedCount} local model(s).`);
       }
     } catch (err) {
       console.warn('[VRAM Monitor] Failed to unload local models:', err);
     }
  }

  private async hasActiveTaskProcess(): Promise<boolean> {
    try {
      const tasks = await orchestrationStore.load('tasks');
      return tasks.some(task =>
        task.status === 'in_progress' ||
        (task.status === 'review' && Boolean(task.checkedOutBy)) ||
        Boolean(task.checkedOutBy)
      );
    } catch {
      // If orchestration state is unavailable, fail-open and avoid destructive kill behavior.
      return true;
    }
  }

  private async purgeCachesAndUnloadModels(): Promise<void> {
    try {
      await cache.clear();
    } catch {
      // Cache clear is best-effort; continue with model unload.
    }
    await this.unloadLocalModels();
    await this.killIdleLocalModelProcesses();
  }

  private async killIdleLocalModelProcesses(): Promise<void> {
    try {
      if (process.platform === 'win32') {
        await execAsync('taskkill /IM ollama.exe /F');
      } else {
        await execAsync('pkill -f ollama');
      }
      console.log('[VRAM Monitor] Killed idle local model process (ollama).');
    } catch {
      // Best-effort kill; ignore when process does not exist or command is unavailable.
    }
  }
}

export const vramMonitor = new VramMonitor();
