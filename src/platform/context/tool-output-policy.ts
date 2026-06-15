import { configManager } from '../../config/index';
import { hasVolatileNumericToolOutput } from '../../agents/prompt-context';
import { truncateToolOutput } from '../../utils/tool-output-truncate';
import type { HandoffPointer, RegisterPayloadMeta } from '../contracts';
import { serializeHandoffPointer } from '../contracts';
import { sessionContextService } from './session-context-service';
import { sessionRagIndex } from './session-rag';

const VOLATILE_TOOL_NAMES = new Set(['web_fetch', 'yahoo_ohlcv', 'ccxt_fetch']);

export function shouldNeverSummarizeTool(toolName: string, content: string): boolean {
  if (VOLATILE_TOOL_NAMES.has(toolName)) return true;
  return hasVolatileNumericToolOutput(content);
}

export function isPointersEnabled(): boolean {
  return configManager.getConfig().agent?.context?.pointers?.enabled === true;
}

export async function registerToolOutputAsPointer(
  scopeId: string,
  toolName: string,
  content: string,
  meta: Partial<RegisterPayloadMeta> = {},
): Promise<HandoffPointer> {
  const pointer = await sessionContextService.registerPayload(scopeId, content, {
    kind: meta.kind ?? 'tool',
    title: meta.title ?? toolName,
    toolName,
    skillId: meta.skillId,
    summary: meta.summary ?? content.slice(0, 2000),
  });
  if (configManager.getConfig().agent?.context?.sessionRag?.enabled) {
    await sessionRagIndex.indexPointer(scopeId, pointer.id, content, pointer.title);
  }
  return pointer;
}

export function pointerToolMessageBody(pointer: HandoffPointer): string {
  return serializeHandoffPointer(pointer);
}

export function legacyTruncateToolContent(toolName: string, content: string, maxChars = 12000): string {
  if (shouldNeverSummarizeTool(toolName, content)) {
    return truncateToolOutput(content, maxChars);
  }
  return content.length <= maxChars ? content : content.substring(0, maxChars) + '\n\n...[OUTPUT TRUNCATED FOR CONTEXT EFFICIENCY]...';
}
