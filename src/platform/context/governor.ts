import { ToolMessage } from '@langchain/core/messages';
import { configManager } from '../../config/index';
import type { HandoffPointer } from '../contracts';
import { parseHandoffPointer, serializeHandoffPointer } from '../contracts';
import { registerToolOutputAsPointer, pointerToolMessageBody } from './tool-output-policy';
import { sessionContextService } from './session-context-service';

function toolMessageChars(messages: ToolMessage[]): number {
  return messages.reduce((sum, m) => sum + (m.content?.toString?.() ?? '').length, 0);
}

export async function applyGovernorSwap(
  messages: ToolMessage[],
  scopeId: string,
): Promise<{ messages: ToolMessage[]; swapped: number }> {
  if (configManager.getConfig().agent?.context?.governor?.enabled !== true) {
    return { messages, swapped: 0 };
  }
  const budget = configManager.getConfig().agent?.turnToolBudgetChars ?? 24_000;
  if (toolMessageChars(messages) <= budget) return { messages, swapped: 0 };
  const preserveLast = 1;
  const fifo = messages.slice(0, Math.max(0, messages.length - preserveLast));
  let swapped = 0;
  const out = [...messages];
  for (let i = 0; i < fifo.length && toolMessageChars(out) > budget; i++) {
    const msg = out[i];
    if (!(msg instanceof ToolMessage)) continue;
    const body = msg.content?.toString?.() ?? '';
    if (body.length < 2000) continue;
    const existing = parseHandoffPointer(body);
    if (existing) continue;
    const pointer = await registerToolOutputAsPointer(scopeId, msg.name ?? 'tool', body, {
      title: msg.name ?? 'tool',
    });
    out[i] = new ToolMessage({
      content: pointerToolMessageBody(pointer),
      tool_call_id: msg.tool_call_id,
      name: msg.name,
    });
    swapped += 1;
  }
  return { messages: out, swapped };
}

export async function swapSingleToolToPointer(
  msg: ToolMessage,
  scopeId: string,
): Promise<ToolMessage> {
  const body = msg.content?.toString?.() ?? '';
  const existing = parseHandoffPointer(body);
  if (existing) return msg;
  const pointer = await registerToolOutputAsPointer(scopeId, msg.name ?? 'tool', body, {
    title: msg.name ?? 'tool',
  });
  return new ToolMessage({
    content: serializeHandoffPointer(pointer),
    tool_call_id: msg.tool_call_id,
    name: msg.name,
  });
}
