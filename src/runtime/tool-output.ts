import { modelRouter } from '../models/model-router';
import { configManager } from '../config/index';
import type { Message } from './messages';
import { toolMessage, messageContentToString } from './messages';
import {
  isPointersEnabled,
  registerToolOutputAsPointer,
  pointerToolMessageBody,
  legacyTruncateToolContent,
  shouldNeverSummarizeTool,
  applyGovernorSwap,
} from '../platform/context';
import { appendFacts, extractFactsFromToolOutput } from '../platform/context/evidence-pipeline';
import { capOrchestratorHandoff, ORCHESTRATOR_HANDOFF_MAX_CHARS } from '../agents/skill-handoff';
import { hasVolatileNumericToolOutput } from '../agents/prompt-context';
import { systemMessage, userMessage } from './messages';

export async function processToolResultMessages(
  results: Array<{ toolCallId: string; name: string; content: string }>,
  scopeId: string,
): Promise<Message[]> {
  const out: Message[] = [];
  for (const msg of results) {
    let contentStr = msg.content ?? '';
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
      out.push(toolMessage(msg.toolCallId, msg.name, contentStr));
      continue;
    }
    if (isPointersEnabled() && contentStr.length > 4000) {
      const pointer = await registerToolOutputAsPointer(scopeId, msg.name, contentStr, {
        kind: 'tool',
        title: msg.name,
      });
      if (configManager.getConfig().agent?.context?.evidencePipeline?.enabled) {
        const facts = extractFactsFromToolOutput(scopeId, msg.name, contentStr, pointer.id);
        if (facts.length > 0) await appendFacts(scopeId, facts);
      }
      out.push(toolMessage(msg.toolCallId, msg.name, pointerToolMessageBody(pointer)));
      continue;
    }
    if (contentStr.length <= 12000) {
      out.push(toolMessage(msg.toolCallId, msg.name, contentStr));
      continue;
    }
    if (msg.name === 'web_fetch' || shouldNeverSummarizeTool(msg.name, contentStr)) {
      contentStr = legacyTruncateToolContent(msg.name, contentStr, 12000);
      out.push(toolMessage(msg.toolCallId, msg.name, contentStr));
      continue;
    }
    if (hasVolatileNumericToolOutput(contentStr)) {
      contentStr =
        contentStr.substring(0, 12000) +
        '\n\n...[OUTPUT TRUNCATED — use web_fetch with part=1+ or focus to read more.]...';
      out.push(toolMessage(msg.toolCallId, msg.name, contentStr));
      continue;
    }
    try {
      const client = await modelRouter.getModel('summarize');
      const summary = await Promise.race([
        client.complete({
          messages: [
            systemMessage('Summarize the tool output accurately under 2000 characters. Retain critical facts.'),
            userMessage(contentStr.substring(0, 40000)),
          ],
          label: 'tool-output-summarize',
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Summarization Timeout')), 60000),
        ),
      ]);
      contentStr = `[Tool Output Summarized for Context Efficiency]:\n${summary.content}`;
    } catch {
      contentStr = legacyTruncateToolContent(msg.name, contentStr, 12000);
    }
    out.push(toolMessage(msg.toolCallId, msg.name, contentStr));
  }
  const governed = await applyGovernorSwap(
    out.map((m) => ({
      content: messageContentToString(m.content),
      tool_call_id: m.toolCallId ?? '',
      name: m.name,
    })),
    scopeId,
  );
  return governed.messages.map((g, i) =>
    toolMessage(g.tool_call_id, g.name ?? out[i].name ?? 'tool', g.content),
  );
}
