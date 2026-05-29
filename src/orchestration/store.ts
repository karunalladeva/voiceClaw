import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import type {
  Company,
  OrgAgent,
  Goal,
  Task,
  TaskComment,
  WorkProduct,
  ApprovalRequest,
  CostEvent,
  ActivityEvent,
  Routine,
} from './types';

const ORCHESTRATION_DIR = path.join(process.cwd(), 'workspace', 'orchestration');

type StoreData = {
  companies: Company[];
  agents: OrgAgent[];
  goals: Goal[];
  tasks: Task[];
  comments: TaskComment[];
  workProducts: WorkProduct[];
  approvals: ApprovalRequest[];
  routines: Routine[];
};

type StoreName = keyof StoreData;

class OrchestrationStore {
  private cache: Partial<StoreData> = {};
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(ORCHESTRATION_DIR, { recursive: true });
    this.initialized = true;
    console.log('[Orchestration] Store initialized at', ORCHESTRATION_DIR);
  }

  private getFilePath(name: StoreName): string {
    return path.join(ORCHESTRATION_DIR, `${name}.json`);
  }

  private getActivityLogPath(): string {
    return path.join(ORCHESTRATION_DIR, 'activity.jsonl');
  }

  private getCostLogPath(): string {
    return path.join(ORCHESTRATION_DIR, 'costs.jsonl');
  }

  async load<T extends StoreName>(name: T): Promise<StoreData[T]> {
    if (this.cache[name]) return this.cache[name] as StoreData[T];

    const filePath = this.getFilePath(name);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as StoreData[T];
      this.cache[name] = data;
      return data;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        const empty: any = [];
        this.cache[name] = empty;
        return empty;
      }
      throw err;
    }
  }

  async save<T extends StoreName>(name: T, data: StoreData[T]): Promise<void> {
    await this.initialize();
    const filePath = this.getFilePath(name);
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
    this.cache[name] = data;
  }

  async appendActivity(event: ActivityEvent): Promise<void> {
    await this.initialize();
    const logPath = this.getActivityLogPath();
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(logPath, line, 'utf-8');
  }

  async appendCost(event: CostEvent): Promise<void> {
    await this.initialize();
    const logPath = this.getCostLogPath();
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(logPath, line, 'utf-8');
  }

  async getRecentActivity(limit: number = 100): Promise<ActivityEvent[]> {
    const logPath = this.getActivityLogPath();
    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines
        .slice(-limit)
        .map(line => JSON.parse(line) as ActivityEvent)
        .reverse();
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async getCostsByAgent(agentId: string, sinceTimestamp?: number): Promise<CostEvent[]> {
    const logPath = this.getCostLogPath();
    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines
        .map(line => JSON.parse(line) as CostEvent)
        .filter(e => e.agentId === agentId && (!sinceTimestamp || e.timestamp >= sinceTimestamp));
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async getCostsByCompany(companyId: string, sinceTimestamp?: number): Promise<CostEvent[]> {
    const logPath = this.getCostLogPath();
    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines
        .map(line => JSON.parse(line) as CostEvent)
        .filter(e => e.companyId === companyId && (!sinceTimestamp || e.timestamp >= sinceTimestamp));
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  invalidateCache(name?: StoreName): void {
    if (name) {
      delete this.cache[name];
    } else {
      this.cache = {};
    }
  }
}

export const orchestrationStore = new OrchestrationStore();

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
