import { orchestrationStore, generateId } from './store';
import { taskManager } from './task-manager';
import type { Routine, ActivityEvent } from './types';

export interface CreateRoutineInput {
  companyId: string;
  name: string;
  description: string;
  assigneeId: string;
  schedule: 'hourly' | 'daily' | 'weekly';
  taskTemplate: {
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
  };
}

class RoutineManager {
  async list(companyId?: string): Promise<Routine[]> {
    const routines = await orchestrationStore.load('routines');
    if (companyId) return routines.filter(r => r.companyId === companyId);
    return routines;
  }

  async getById(id: string): Promise<Routine | undefined> {
    const routines = await orchestrationStore.load('routines');
    return routines.find(r => r.id === id);
  }

  async create(input: CreateRoutineInput): Promise<Routine> {
    const routines = await orchestrationStore.load('routines');
    
    // Calculate first run
    const now = Date.now();
    let nextRunAt = now;
    if (input.schedule === 'hourly') nextRunAt += 60 * 60 * 1000;
    else if (input.schedule === 'daily') nextRunAt += 24 * 60 * 60 * 1000;
    else if (input.schedule === 'weekly') nextRunAt += 7 * 24 * 60 * 60 * 1000;

    const routine: Routine = {
      id: generateId(),
      companyId: input.companyId,
      name: input.name,
      description: input.description,
      assigneeId: input.assigneeId,
      schedule: input.schedule,
      enabled: true,
      taskTemplate: input.taskTemplate,
      nextRunAt,
      createdAt: now,
    };

    routines.push(routine);
    await orchestrationStore.save('routines', routines);

    await this.logActivity({
      companyId: input.companyId,
      actorId: 'system',
      actorType: 'system',
      action: 'routine:created',
      entityType: 'task',
      entityId: routine.id,
      data: { name: routine.name, schedule: routine.schedule },
    });

    console.log(`[Orchestration] Routine created: ${routine.name} (${routine.schedule})`);
    return routine;
  }

  async toggle(id: string, enabled: boolean): Promise<Routine | null> {
    const routines = await orchestrationStore.load('routines');
    const routine = routines.find(r => r.id === id);
    if (!routine) return null;

    routine.enabled = enabled;
    await orchestrationStore.save('routines', routines);
    return routine;
  }

  async delete(id: string): Promise<boolean> {
    const routines = await orchestrationStore.load('routines');
    const routine = routines.find(r => r.id === id);
    if (!routine) return false;

    const filtered = routines.filter(r => r.id !== id);
    await orchestrationStore.save('routines', filtered);

    await this.logActivity({
      companyId: routine.companyId,
      actorId: 'system',
      actorType: 'system',
      action: 'routine:deleted',
      entityType: 'task',
      entityId: id,
      data: { name: routine.name },
    });

    return true;
  }

  private async logActivity(event: Omit<ActivityEvent, 'id' | 'timestamp'>): Promise<void> {
    await orchestrationStore.appendActivity({
      id: generateId(),
      timestamp: Date.now(),
      ...event,
    });
  }
}

export const routineManager = new RoutineManager();
