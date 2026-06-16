import type { Message, ToolCall } from '../runtime/messages';
import type { ToolDefinition } from '../runtime/tools';

export interface LlmCompleteRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  label?: string;
}

export interface LlmCompleteResponse {
  content: string;
  toolCalls?: ToolCall[];
}

export interface LlmStreamChunk {
  type: 'token' | 'tool_calls' | 'done';
  token?: string;
  toolCalls?: ToolCall[];
  content?: string;
}

export interface LlmClient {
  readonly modelId: string;
  complete(req: LlmCompleteRequest): Promise<LlmCompleteResponse>;
  stream?(req: LlmCompleteRequest): AsyncGenerator<LlmStreamChunk>;
}
