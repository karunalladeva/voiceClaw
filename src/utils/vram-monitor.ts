import { exec } from 'child_process';
import { promisify } from 'util';
import { modelRegistry } from '../models/model-registry';

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
             console.warn('[VRAM Monitor] VRAM usage exceeded 90%. Purging caches and unloading models...');
             await this.unloadLocalModels();
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
}

export const vramMonitor = new VramMonitor();
