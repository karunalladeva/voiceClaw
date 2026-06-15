import { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import { MessagesAnnotation } from '@langchain/langgraph';
// @ts-ignore
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { formatMissingToolArgs } from '../../utils/soften-tool-schema';
import { getAgentRunContext, getAgentRunStorage } from '../agent-run-context';
import { getRunContext, getRunContextStorage } from '../../platform/session/run-context-storage';

function isToolArgErrorContent(text: string): boolean {
  return (
    text.includes('did not match expected schema') ||
    text.includes('without required arguments') ||
    text.includes('Please fix your mistakes')
  );
}

export function countRepeatedToolArgErrors(messages: BaseMessage[], toolName: string): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!(msg instanceof ToolMessage) || msg.name !== toolName) {
      break;
    }
    if (isToolArgErrorContent(msg.content.toString())) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function toolMessageForInvalidCall(tc: { id?: string; name: string; args?: Record<string, unknown> }): ToolMessage {
  const args = tc.args ?? {};
  const emptyArgs = Object.keys(args).length === 0;
  const missing = emptyArgs
    ? ['required arguments']
    : Object.entries(args)
        .filter(([, v]) => v === undefined || v === null || (typeof v === 'string' && !v.trim()))
        .map(([k]) => k);
  return new ToolMessage({
    content: formatMissingToolArgs(tc.name, missing.length > 0 ? missing : ['required arguments']),
    tool_call_id: tc.id ?? '',
    name: tc.name,
  });
}

function toolMessageForRetryLimit(tc: { id?: string; name: string }, attempts: number): ToolMessage {
  return new ToolMessage({
    content:
      `Stopped retrying ${tc.name}: invalid or empty args ${attempts} times in a row. ` +
      `Respond in plain text with what you intended, or call a different tool with complete JSON arguments.`,
    tool_call_id: tc.id ?? '',
    name: tc.name,
  });
}

function toolMessageForUnknownTool(
  tc: { id?: string; name: string },
  available: string[],
): ToolMessage {
  const skillHint =
    tc.name === 'web_search' || tc.name === 'web_fetch'
      ? ' Use route_to_skill with a research skill, or read_file on upstream artifact paths.'
      : ' Use route_to_skill for skills listed in your allowed capabilities.';
  return new ToolMessage({
    content:
      `Error: Tool "${tc.name}" is not available in this org run. ` +
      `Available tools: ${available.join(', ')}.${skillHint}`,
    tool_call_id: tc.id ?? '',
    name: tc.name,
  });
}

export async function invokeSafeToolNode(
  tools: DynamicStructuredTool[],
  state: typeof MessagesAnnotation.State,
): Promise<{ messages: ToolMessage[] }> {
  const toolNames = new Set(tools.map((t) => t.name));
  const available = [...toolNames].sort();
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
    const responses: ToolMessage[] = [];
    let allLocal = true;
    for (const tc of lastMessage.tool_calls) {
      if (!toolNames.has(tc.name)) {
        responses.push(toolMessageForUnknownTool(tc, available));
        continue;
      }
      const priorErrors = countRepeatedToolArgErrors(state.messages, tc.name);
      if (priorErrors >= 2) {
        responses.push(toolMessageForRetryLimit(tc, priorErrors + 1));
        continue;
      }
      const args = (tc.args ?? {}) as Record<string, unknown>;
      if (Object.keys(args).length === 0) {
        responses.push(toolMessageForInvalidCall(tc));
        continue;
      }
      allLocal = false;
    }
    if (allLocal && responses.length === lastMessage.tool_calls.length) {
      return { messages: responses };
    }
  }

  try {
    const invokeTools = () => new ToolNode(tools).invoke(state);
    const agentCtx = getAgentRunContext();
    const platformCtx = getRunContext();
    if (agentCtx && platformCtx) {
      const agentStorage = getAgentRunStorage();
      const platformStorage = getRunContextStorage();
      return await agentStorage.run(agentCtx, () =>
        platformStorage.run(platformCtx, invokeTools),
      );
    }
    if (agentCtx) {
      return await getAgentRunStorage().run(agentCtx, invokeTools);
    }
    if (platformCtx) {
      return await getRunContextStorage().run(platformCtx, invokeTools);
    }
    return await invokeTools();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found') && lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
      return {
        messages: lastMessage.tool_calls.map((tc) =>
          toolNames.has(tc.name)
            ? toolMessageForInvalidCall(tc)
            : toolMessageForUnknownTool(tc, available),
        ),
      };
    }
    if (
      !message.includes('did not match expected schema') &&
      !message.includes('ToolInputParsingException')
    ) {
      throw err;
    }
    if (!(lastMessage instanceof AIMessage) || !lastMessage.tool_calls?.length) {
      throw err;
    }
    return {
      messages: lastMessage.tool_calls.map((tc) => toolMessageForInvalidCall(tc)),
    };
  }
}
