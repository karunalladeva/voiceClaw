import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { modelRouter } from '../../models/model-router';
import { configManager } from '../../config/index';
import type { RunContext } from '../../platform/contracts';
import {
  isPointersEnabled,
  registerToolOutputAsPointer,
  pointerToolMessageBody,
  legacyTruncateToolContent,
  shouldNeverSummarizeTool,
  applyGovernorSwap,
} from '../../platform/context';
import { appendFacts, extractFactsFromToolOutput } from '../../platform/context/evidence-pipeline';
import { capOrchestratorHandoff, ORCHESTRATOR_HANDOFF_MAX_CHARS } from '../skill-handoff';
import { hasVolatileNumericToolOutput } from '../prompt-context';

export async function processToolMessages(
  messages: ToolMessage[],
  scopeId: string,
): Promise<ToolMessage[]> {
  const out: ToolMessage[] = [];
  for (const msg of messages) {
    let contentStr = msg.content?.toString?.() ?? '';
    if (contentStr.includes('[Sub-Agent Result from')) {
      if (contentStr.length > ORCHESTRATOR_HANDOFF_MAX_CHARS) {
        if (isPointersEnabled()) {
          const pointer = await registerToolOutputAsPointer(scopeId, 'route_to_skill', contentStr, {
            kind: 'skill',
            title: 'skill handoff',
          });
          contentStr = pointerToolMessageBody(pointer);
        } else {
          contentStr = capOrchestratorHandoff(contentStr);
        }
      }
      out.push(new ToolMessage({ content: contentStr, tool_call_id: msg.tool_call_id, name: msg.name }));
      continue;
    }
    if (isPointersEnabled() && contentStr.length > 4000) {
      const pointer = await registerToolOutputAsPointer(scopeId, msg.name ?? 'tool', contentStr, {
        kind: 'tool',
        title: msg.name ?? 'tool',
      });
      if (configManager.getConfig().agent?.context?.evidencePipeline?.enabled) {
        const facts = extractFactsFromToolOutput(scopeId, msg.name ?? 'tool', contentStr, pointer.id);
        if (facts.length > 0) await appendFacts(scopeId, facts);
      }
      out.push(
        new ToolMessage({
          content: pointerToolMessageBody(pointer),
          tool_call_id: msg.tool_call_id,
          name: msg.name,
        }),
      );
      continue;
    }
    if (contentStr.length <= 12000) {
      out.push(msg);
      continue;
    }
    if (msg.name === 'web_fetch' || shouldNeverSummarizeTool(msg.name ?? '', contentStr)) {
      contentStr = legacyTruncateToolContent(msg.name ?? 'tool', contentStr, 12000);
      out.push(new ToolMessage({ content: contentStr, tool_call_id: msg.tool_call_id, name: msg.name }));
      continue;
    }
    if (hasVolatileNumericToolOutput(contentStr)) {
      contentStr =
        contentStr.substring(0, 12000) +
        '\n\n...[OUTPUT TRUNCATED — use web_fetch with part=1+ or focus to read more. Do not invent missing numbers.]...';
      out.push(new ToolMessage({ content: contentStr, tool_call_id: msg.tool_call_id, name: msg.name }));
      continue;
    }
    try {
      const fastModel = await modelRouter.getModel('summarize');
      const summary = await Promise.race([
        fastModel.invoke([
          new SystemMessage(
            'Summarize the tool output accurately under 2000 characters. Retain critical facts.',
          ),
          new HumanMessage({ content: contentStr.substring(0, 40000) }),
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Summarization Timeout')), 60000)),
      ]);
      contentStr = `[Tool Output Summarized for Context Efficiency]:\n${(summary as { content: { toString(): string } }).content.toString()}`;
    } catch {
      contentStr = legacyTruncateToolContent(msg.name ?? 'tool', contentStr, 12000);
    }
    out.push(new ToolMessage({ content: contentStr, tool_call_id: msg.tool_call_id, name: msg.name }));
  }
  const governed = await applyGovernorSwap(out, scopeId);
  return governed.messages;
}

export function scopeFromRunContext(ctx: RunContext | undefined, chatId: string): string {
  return ctx?.scopeId ?? `chat:${chatId}`;
}
