export interface AgentRunOptions {
  modelId?: string;
  skillIds?: string[];
  orgAgentId?: string;
  orgTaskId?: string;
  orgRootTaskId?: string;
  orgSystemAppend?: string;
  allowedReadPaths?: import('../orchestration/artifact-read-allowlist').ReadAllowlistResult;
  isManagerRun?: boolean;
  pipelineMode?: boolean;
  blockersOpen?: boolean;
  userDecisionBound?: boolean;
  /** Platform run context (chat + org). */
  runContext?: import('../platform/contracts').RunContext;
}
