import { notifyOrchestrationUpdate } from '../admin/admin-server';
import { orchestrationStore, generateId } from './store';
import type { AgentRunMode, AgentRunRecord, OrgAgent, Task } from './types';

export interface LogAgentRunParams {
  agent: OrgAgent;
  task: Task | null;
  mode: AgentRunMode;
  modelId: string;
  prompt: string;
  answer: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

export async function logAgentRun(params: LogAgentRunParams): Promise<AgentRunRecord> {
  const record: AgentRunRecord = {
    id: generateId(),
    companyId: params.agent.companyId,
    agentId: params.agent.id,
    agentName: params.agent.name,
    taskId: params.task?.id,
    taskTitle: params.task?.title,
    mode: params.mode,
    modelId: params.modelId,
    prompt: params.prompt,
    answer: params.answer,
    success: params.success,
    error: params.error,
    durationMs: params.durationMs,
    createdAt: Date.now(),
  };
  await orchestrationStore.appendAgentRun(record);
  notifyOrchestrationUpdate('orchestration');
  return record;
}
