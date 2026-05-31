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
  AgentRunRecord,
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
  /** Serialize writes per JSON file (15s heartbeats overlap on agents.json). */
  private saveQueues = new Map<StoreName, Promise<void>>();
  /** Serialized read-modify-write for tasks.json. */
  private taskMutateQueue: Promise<void> = Promise.resolve();

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

  private getAgentRunsLogPath(): string {
    return path.join(ORCHESTRATION_DIR, 'agent-runs.jsonl');
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
    const job = (this.saveQueues.get(name) ?? Promise.resolve()).then(() =>
      this.persistToDisk(name, data),
    );
    this.saveQueues.set(
      name,
      job.catch(() => undefined),
    );
    await job;
  }

  private async persistToDisk<T extends StoreName>(name: T, data: StoreData[T]): Promise<void> {
    await this.initialize();
    const filePath = this.getFilePath(name);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify(data, null, 2);
    try {
      await fs.writeFile(tempPath, payload, 'utf-8');
      await this.replaceFile(tempPath, filePath);
      this.cache[name] = data;
    } catch (err) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw err;
    }
  }

  /** Atomic replace; Windows cannot rename over an existing target in all cases. */
  private async replaceFile(tempPath: string, filePath: string): Promise<void> {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw new Error(
          `Orchestration save failed: temp file missing before rename (${tempPath}). ` +
            'Another process may have deleted it; retry the operation.',
        );
      }
      if (code === 'EPERM' || code === 'EEXIST' || code === 'EBUSY') {
        await fs.copyFile(tempPath, filePath);
        await fs.unlink(tempPath);
        return;
      }
      throw err;
    }
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

  async appendAgentRun(record: AgentRunRecord): Promise<void> {
    await this.initialize();
    const logPath = this.getAgentRunsLogPath();
    const line = JSON.stringify(record) + '\n';
    await fs.appendFile(logPath, line, 'utf-8');
  }

  async getAgentRuns(params: {
    companyId: string;
    agentId?: string;
    limit?: number;
  }): Promise<AgentRunRecord[]> {
    const limit = params.limit ?? 100;
    const logPath = this.getAgentRunsLogPath();
    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const runs = lines
        .map((line) => JSON.parse(line) as AgentRunRecord)
        .filter((r) => r.companyId === params.companyId)
        .filter((r) => !params.agentId || r.agentId === params.agentId)
        .reverse();
      return runs.slice(0, limit);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return [];
      throw err;
    }
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

  /**
   * Atomic read-modify-write for tasks.json. Mutator may mutate the array in place.
   * Returns the mutator's return value (e.g. a single Task).
   */
  async mutateTasks<TResult>(
    mutator: (tasks: Task[]) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    let result!: TResult;
    const job = this.taskMutateQueue.then(async () => {
      await this.initialize();
      const tasks = [...(await this.load('tasks'))] as Task[];
      result = await mutator(tasks);
      await this.persistToDisk('tasks', tasks);
      return result;
    });
    this.taskMutateQueue = job.then(() => undefined).catch(() => undefined);
    return job;
  }
}

export const orchestrationStore = new OrchestrationStore();

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
