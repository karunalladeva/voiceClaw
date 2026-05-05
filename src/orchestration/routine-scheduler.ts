import { routineManager } from './routine-manager';
import { taskManager } from './task-manager';
import { orchestrationStore } from './store';

class RoutineScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Check every minute
    this.timer = setInterval(() => this.checkRoutines(), 60000);
    console.log('[Orchestration] Routine scheduler started');
    
    // Run an initial check shortly after startup
    setTimeout(() => this.checkRoutines(), 5000);
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Orchestration] Routine scheduler stopped');
  }

  private async checkRoutines() {
    try {
      const routines = await orchestrationStore.load('routines');
      let updated = false;
      const now = Date.now();

      for (const routine of routines) {
        if (!routine.enabled) continue;
        
        // If nextRunAt is in the past or undefined, we need to run it
        if (!routine.nextRunAt || routine.nextRunAt <= now) {
          console.log(`[Orchestration] Triggering routine: ${routine.name}`);
          
          // Spawn the task
          await taskManager.createTask({
            companyId: routine.companyId,
            title: `[Routine] ${routine.taskTemplate.title}`,
            description: routine.taskTemplate.description || routine.description,
            priority: routine.taskTemplate.priority as any || 'medium',
            assigneeId: routine.assigneeId,
            createdBy: 'system',
            labels: ['routine'],
          });

          // Update routine schedule
          routine.lastRunAt = now;
          
          let nextRunAt = now;
          if (routine.schedule === 'hourly') nextRunAt += 60 * 60 * 1000;
          else if (routine.schedule === 'daily') nextRunAt += 24 * 60 * 60 * 1000;
          else if (routine.schedule === 'weekly') nextRunAt += 7 * 24 * 60 * 60 * 1000;
          
          routine.nextRunAt = nextRunAt;
          updated = true;
        }
      }

      if (updated) {
        await orchestrationStore.save('routines', routines);
      }
    } catch (err: any) {
      console.error('[Orchestration] Error in routine scheduler:', err.message);
    }
  }
}

export const routineScheduler = new RoutineScheduler();
