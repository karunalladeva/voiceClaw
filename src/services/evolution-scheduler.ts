/**
 * Evolution Scheduler — Automated cron-based training trigger.
 *
 * Runs on a configurable schedule (default: Sundays 03:00 AM).
 * Pre-flight checks: VRAM guard, minimum verified samples, no active training.
 */

import { evolutionService } from './evolution-service';
import { configManager } from '../config/index';

// ── Simple Cron (avoids new dependency — reuses the pipeline ticker pattern) ──

interface ScheduleConfig {
  enabled: boolean;
  schedule: string;     // e.g. "0 3 * * 0" — but we parse simpler forms too
  autoHarvest: boolean;
}

function getEvolutionConfig(): ScheduleConfig {
  const config = configManager.getConfig();
  const evo = (config as any).evolution || {};
  return {
    enabled: evo.enabled ?? false,
    schedule: evo.schedule || '0 3 * * 0',
    autoHarvest: evo.autoHarvest ?? true,
  };
}

/**
 * Parse a simplified schedule string and return the interval in milliseconds.
 * Supports: "weekly", "daily", "every N hours", "every N minutes"
 * For cron-style "0 3 * * 0", we fall back to weekly for simplicity (matches Sunday 3AM intent).
 */
function parseScheduleInterval(schedule: string): number {
  const s = schedule.toLowerCase().trim();

  if (s.includes('minute')) {
    const m = s.match(/(\d+)\s*min/);
    return (m ? parseInt(m[1]) : 1) * 60_000;
  }
  if (s.includes('hour')) {
    const m = s.match(/(\d+)\s*hour/);
    return (m ? parseInt(m[1]) : 1) * 3_600_000;
  }
  if (s.includes('daily') || s.includes('every day')) {
    return 86_400_000;
  }
  if (s.includes('weekly') || s.includes('every week') || s.match(/^\d+\s+\d+\s+\*\s+\*\s+\d$/)) {
    return 604_800_000; // 7 days
  }

  // Default: weekly
  return 604_800_000;
}

class EvolutionScheduler {
  private ticker: NodeJS.Timeout | null = null;
  private lastCheckTime: number = 0;

  /**
   * Start the evolution scheduler. Reuses the same interval-polling pattern
   * as the pipeline engine to keep dependencies minimal.
   */
  start(): void {
    if (this.ticker) return;

    const config = getEvolutionConfig();
    if (!config.enabled) {
      console.log('[Evolution Scheduler] Disabled in config. Skipping.');
      return;
    }

    const intervalMs = parseScheduleInterval(config.schedule);
    this.lastCheckTime = Date.now();

    console.log(`[Evolution Scheduler] Started (interval: ${intervalMs / 60_000} minutes).`);

    this.ticker = setInterval(async () => {
      try {
        const cfg = getEvolutionConfig();
        if (!cfg.enabled) return;

        const now = Date.now();
        const elapsed = now - this.lastCheckTime;
        const due = elapsed >= intervalMs;

        if (!due) return;
        this.lastCheckTime = now;

        console.log('[Evolution Scheduler] Schedule triggered — running pre-flight checks...');

        // Pre-flight 1: Check if training is already running
        const status = evolutionService.getTrainingStatus();
        if (status?.status === 'running') {
          console.log('[Evolution Scheduler] Training already in progress. Skipping.');
          return;
        }

        // Pre-flight 2: Auto-harvest if enabled
        if (cfg.autoHarvest) {
          console.log('[Evolution Scheduler] Running auto-harvest...');
          await evolutionService.harvestWorkspace();
        }

        // Pre-flight 3: Check sample count
        const stats = await evolutionService.getStats();
        if (!stats.trainUnlocked) {
          console.log(`[Evolution Scheduler] Not enough samples (${stats.approved}/${stats.minSamples}). Skipping.`);
          return;
        }

        // Pre-flight 4: VRAM guard
        const vram = await evolutionService.checkVRAMGuard();
        if (!vram.safe) {
          console.log(`[Evolution Scheduler] VRAM too high (${vram.usedMB}MB). Postponing training.`);
          return;
        }

        // All checks passed — start training
        console.log('[Evolution Scheduler] All pre-flight checks passed. Starting training...');
        await evolutionService.startTraining();

      } catch (err: any) {
        console.error('[Evolution Scheduler] Error:', err.message);
      }
    }, 60_000); // Check every 60 seconds

    // Auto-harvest on startup if configured
    if (config.autoHarvest) {
      setTimeout(async () => {
        try {
          const cfg = getEvolutionConfig();
          if (cfg.enabled && cfg.autoHarvest) {
            console.log('[Evolution Scheduler] Running startup harvest...');
            await evolutionService.harvestWorkspace();
          }
        } catch (err: any) {
          console.error('[Evolution Scheduler] Startup harvest failed:', err.message);
        }
      }, 10_000); // 10s after boot
    }
  }

  stop(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
      console.log('[Evolution Scheduler] Stopped.');
    }
  }
}

export const evolutionScheduler = new EvolutionScheduler();
