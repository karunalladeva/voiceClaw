import type { ReactAgent } from './react-agent';

let sharedAgent: ReactAgent | null = null;

export function setSharedReactAgent(agent: ReactAgent): void {
  sharedAgent = agent;
}

export function getSharedReactAgent(): ReactAgent {
  if (!sharedAgent) {
    throw new Error('[SharedAgent] ReactAgent not initialized — call setSharedReactAgent at server startup');
  }
  return sharedAgent;
}
