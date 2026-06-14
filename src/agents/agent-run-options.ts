export interface AgentRunOptions {
  modelId?: string;
  skillIds?: string[];
  /** Org agent id when running a heartbeat / orchestration assignment */
  orgAgentId?: string;
  /** Active task id for delegation tools (create_subtask) */
  orgTaskId?: string;
  /** Root epic id — artifact folder parent (defaults to orgTaskId for user tasks) */
  orgRootTaskId?: string;
  /** Extra system prompt for org / heartbeat runs */
  orgSystemAppend?: string;
  /** Pipeline artifact read allowlist for this run */
  allowedReadPaths?: import('../orchestration/artifact-read-allowlist').ReadAllowlistResult;
  isManagerRun?: boolean;
  pipelineMode?: boolean;
  blockersOpen?: boolean;
  userDecisionBound?: boolean;
}
