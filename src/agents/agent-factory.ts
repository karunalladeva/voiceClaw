import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
// @ts-ignore
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { SkillDefinition, SkillToolLimits } from '../skills/base-skill';
import { StreamEvent } from './react-agent';
import { modelRegistry } from '../models/model-registry';
import { modelRouter } from '../models/model-router';
import { truncateToolMessages, truncateToolOutput } from '../utils/tool-output-truncate';
import { invokeWithToolXmlFallback } from '../utils/ollama-tool-call';
import { invokeLlmWithDebug } from '../utils/debug-logger';
import { getAgentRunContext, toTaskArtifactScope } from './agent-run-context';
import { persistTaskResponse } from '../orchestration/task-response-store';
import { isInferenceInterruptError } from '../utils/inference-interrupt';
import {
  assessStructuredOutput,
  enrichHandoffWithStructuredOutput,
} from './skill-structured-output';
import {
  composeSkillHandoff,
  extractToolOutputFromEvent,
  SKILL_RUN_INCOMPLETE_MARKER,
  type SkillToolTrace,
} from './skill-handoff';
export {
  SKILL_RUN_INCOMPLETE_MARKER,
  composeSkillHandoff,
  extractToolOutputFromEvent,
} from './skill-handoff';

/** Match main ReAct agent — room for many tool rounds without GraphRecursionError. */
const SKILL_RECURSION_LIMIT = 100;
/** Skills may queue several Playwright fetches after web_search (lock + browser launch). */
const SKILL_RUN_TIMEOUT_MS = 300_000;
const DEFAULT_SKILL_TOOL_LIMITS: Required<SkillToolLimits> = {
  maxWebSearch: 6,
  maxWebFetch: 5,
};
const GRACE_SYNTHESIS_TRACE_MAX_CHARS = 4000;
const MIN_SYNTHESIS_NARRATIVE_CHARS = 80;

function resolveSkillToolLimits(skill: SkillDefinition): Required<SkillToolLimits> {
  return {
    maxWebSearch: skill.toolLimits?.maxWebSearch ?? DEFAULT_SKILL_TOOL_LIMITS.maxWebSearch,
    maxWebFetch: skill.toolLimits?.maxWebFetch ?? DEFAULT_SKILL_TOOL_LIMITS.maxWebFetch,
  };
}

function isGraphRecursionError(err: unknown): boolean {
  const e = err as { name?: string; message?: string; lc_error_code?: string };
  return (
    e?.name === 'GraphRecursionError' ||
    e?.lc_error_code === 'GRAPH_RECURSION_LIMIT' ||
    /recursion limit of \d+ reached/i.test(e?.message ?? '')
  );
}

function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((block: { text?: string }) => block?.text ?? '').join('');
  }
  return content == null ? '' : String(content);
}

export class AgentFactory {
  private cache: Map<string, any> = new Map();

  private async resolveSkillLlm(skill: SkillDefinition): Promise<BaseChatModel> {
    if (skill.model) {
      const byId = modelRegistry.getById(skill.model);
      if (byId) {
        return (await modelRouter.getById(skill.model))!;
      }
      const { ChatOllama } = await import('@langchain/ollama');
      return new ChatOllama({
        model: skill.model,
        temperature: skill.temperature ?? 0.2,
        keepAlive: -1,
      }) as unknown as BaseChatModel;
    }
    return modelRouter.getMasterModel();
  }

  async getAgentAsync(skill: SkillDefinition): Promise<any> {
    if (this.cache.has(skill.id)) return this.cache.get(skill.id)!;

    const llm = await this.resolveSkillLlm(skill);
    const compiled = this.buildGraph(llm, skill);
    this.cache.set(skill.id, compiled);
    console.log(`[AgentFactory] Built agent for skill: ${skill.name}`);
    return compiled;
  }

  getAgent(skill: SkillDefinition): any {
    if (this.cache.has(skill.id)) return this.cache.get(skill.id)!;
    this.getAgentAsync(skill).catch((err) =>
      console.error(`[AgentFactory] Async build failed for ${skill.id}:`, err)
    );
    return this.cache.get(skill.id) ?? null;
  }

  private buildGraph(llm: BaseChatModel, skill: SkillDefinition): any {
    const tools = skill.tools;
    const llmWithTools: any = tools.length > 0 ? (llm as any).bindTools(tools) : llm;

    const callModel = async (state: typeof MessagesAnnotation.State) => {
      const response = await invokeWithToolXmlFallback(
        llmWithTools,
        llm,
        state.messages,
        { label: `skill:${skill.name}` },
      );
      return { messages: [response] };
    };

    const toolNode = async (state: typeof MessagesAnnotation.State) => {
      const output = await new ToolNode(tools).invoke(state);
      truncateToolMessages(output.messages);
      return output;
    };

    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      const last = state.messages[state.messages.length - 1] as any;
      return last.tool_calls?.length ? 'tools' : '__end__';
    };

    const workflow = new StateGraph(MessagesAnnotation)
      .addNode('agent', callModel)
      .addNode('tools', toolNode)
      .addEdge('__start__', 'agent')
      .addConditionalEdges('agent', shouldContinue)
      .addEdge('tools', 'agent');

    return workflow.compile();
  }

  private async runGraceSynthesis(
    skill: SkillDefinition,
    query: string,
    toolTraces: SkillToolTrace[],
    reason: string,
  ): Promise<string> {
    if (toolTraces.length === 0) return '';
    const llm = await this.resolveSkillLlm(skill);
    const appendix = toolTraces
      .map(
        (trace, index) =>
          `### ${index + 1}. ${trace.name}\n${truncateToolOutput(trace.output, GRACE_SYNTHESIS_TRACE_MAX_CHARS)}`,
      )
      .join('\n\n');
    const instruction =
      `Tool run stopped (${reason}). Write your final answer from the collected tool output below. ` +
      `Follow your skill instructions, including any required fenced \`\`\`json\`\`\` block. ` +
      `Mark unverified data clearly; do not invent metrics.`;
    try {
      const response = await invokeLlmWithDebug(
        llm,
        [
          new SystemMessage(skill.systemPrompt),
          new HumanMessage({ content: query }),
          new HumanMessage({
            content: `${instruction}\n\n--- Collected tool output ---\n\n${appendix}`,
          }),
        ],
        { label: `skill-grace:${skill.name}` },
      );
      return messageContentToString(response.content).trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AgentFactory] Grace synthesis failed for "${skill.name}": ${msg}`);
      return '';
    }
  }

  private needsGraceSynthesis(fullText: string, skillEndedEarly: boolean, toolTraces: SkillToolTrace[]): boolean {
    if (toolTraces.length === 0) return false;
    if (skillEndedEarly) return fullText.trim().length < MIN_SYNTHESIS_NARRATIVE_CHARS;
    return false;
  }

  async *runStream(skill: SkillDefinition, query: string): AsyncGenerator<StreamEvent> {
    console.log(`[AgentFactory] Running skill "${skill.name}" for: "${query.substring(0, 60)}…"`);
    yield { type: 'thinking', data: `Using skill: ${skill.name}…` };

    const graph = await this.getAgentAsync(skill);
    if (!graph) {
      yield { type: 'error', data: `Skill ${skill.name} agent not ready yet. Please retry.` };
      return;
    }

    const inputMessages = {
      messages: [
        new SystemMessage(skill.systemPrompt),
        new HumanMessage({ content: query }),
      ],
    };

    let fullText = '';
    const toolTraces: SkillToolTrace[] = [];
    const { maxWebSearch, maxWebFetch } = resolveSkillToolLimits(skill);
    let webSearchCount = 0;
    let webFetchCount = 0;
    let skillEndedEarly = false;
    let earlyStopReason = 'tool budget or timeout';
    const deadline = Date.now() + SKILL_RUN_TIMEOUT_MS;
    const runCtxAtStart = getAgentRunContext();
    if (runCtxAtStart) {
      runCtxAtStart.skillRunCancelled = false;
      runCtxAtStart.lastUserQuery = query.trim();
      runCtxAtStart.webFetchKeys = new Set();
    }

    try {
      const stream = graph.streamEvents(inputMessages, {
        version: 'v2',
        recursionLimit: SKILL_RECURSION_LIMIT,
      });
      const streamIterator = stream[Symbol.asyncIterator]();

      try {
        while (true) {
          let step: IteratorResult<unknown>;
          try {
            step = await streamIterator.next();
          } catch (streamErr: unknown) {
            if (isGraphRecursionError(streamErr)) {
              console.warn(
                `[AgentFactory] Skill "${skill.name}" hit LangGraph recursion limit (${SKILL_RECURSION_LIMIT}) — stopping with partial output`,
              );
              skillEndedEarly = true;
              earlyStopReason = 'recursion limit';
              break;
            }
            if (skillEndedEarly || isInferenceInterruptError(streamErr)) break;
            throw streamErr;
          }
          if (step.done) break;
          const event = step.value as {
            event?: string;
            name?: string;
            data?: {
              chunk?: { content?: unknown; tool_call_chunks?: unknown[] };
              output?: { messages?: Array<{ content?: unknown }> };
            };
          };

          if (Date.now() > deadline) {
            skillEndedEarly = true;
            earlyStopReason = 'timeout';
            break;
          }
          if (event.event === 'on_tool_start' && event.name === 'web_search') {
            webSearchCount += 1;
            if (webSearchCount > maxWebSearch) {
              console.warn(
                `[AgentFactory] Skill "${skill.name}" hit web_search limit (${maxWebSearch}) — stopping stream`,
              );
              skillEndedEarly = true;
              earlyStopReason = 'web_search limit';
              break;
            }
          }
          if (event.event === 'on_tool_start' && event.name === 'web_fetch' && maxWebFetch > 0) {
            webFetchCount += 1;
            if (webFetchCount > maxWebFetch) {
              console.warn(
                `[AgentFactory] Skill "${skill.name}" hit web_fetch limit (${maxWebFetch}) — stopping stream`,
              );
              skillEndedEarly = true;
              earlyStopReason = 'web_fetch limit';
              break;
            }
          }
          if (event.event === 'on_chat_model_stream') {
            const chunk = event.data?.chunk;
            const hasToolCallChunks = (chunk?.tool_call_chunks?.length ?? 0) > 0;
            if (chunk?.content && !hasToolCallChunks) {
              const token = chunk.content.toString();
              if (token) {
                fullText += token;
                yield { type: 'token', data: token };
              }
            }
          } else if (event.event === 'on_tool_start') {
            console.log(`[AgentFactory] Skill "${skill.name}" tool: ${event.name || 'unknown'}`);
            yield { type: 'tool_call', data: event.name || 'unknown' };
          } else if (event.event === 'on_tool_end') {
            const toolName = event.name || 'unknown';
            const toolOutput = extractToolOutputFromEvent(event.data).trim();
            console.log(`[AgentFactory] Skill "${skill.name}" tool done: ${toolName}`);
            if (toolOutput) {
              toolTraces.push({ name: toolName, output: toolOutput });
              const runCtx = getAgentRunContext();
              if (runCtx) {
                persistTaskResponse({
                  task: toTaskArtifactScope(runCtx),
                  responderId: toolName,
                  responderType: 'tool',
                  content: toolOutput,
                  agentId: runCtx.orgAgentId,
                  success: true,
                });
              }
            }
          } else if (event.event === 'on_chain_end' && event.name === 'agent') {
            const messages = event.data?.output?.messages as Array<{ content?: unknown }> | undefined;
            if (messages?.length) {
              for (let i = messages.length - 1; i >= 0; i--) {
                const text = messageContentToString(messages[i]?.content);
                if (text.trim()) {
                  fullText = text;
                  break;
                }
              }
            }
          }
        }
      } finally {
        const runCtx = getAgentRunContext();
        if (runCtx && skillEndedEarly) {
          runCtx.skillRunCancelled = true;
        }
        try {
          await streamIterator.return?.();
        } catch (closeErr: unknown) {
          if (!isInferenceInterruptError(closeErr)) {
            console.warn(`[AgentFactory] Skill "${skill.name}" stream close:`, closeErr);
          }
        }
      }

      if (this.needsGraceSynthesis(fullText, skillEndedEarly, toolTraces)) {
        const synthesized = await this.runGraceSynthesis(
          skill,
          query,
          toolTraces,
          earlyStopReason,
        );
        if (synthesized) {
          fullText = synthesized;
          console.log(`[AgentFactory] Skill "${skill.name}" grace synthesis produced ${fullText.length} chars`);
        }
      }

      let incomplete = skillEndedEarly;
      const structuredConfig = skill.structuredOutput;
      if (structuredConfig) {
        let structured = assessStructuredOutput(fullText, structuredConfig);
        if (!structured.valid && toolTraces.length > 0) {
          const synthesized = await this.runGraceSynthesis(
            skill,
            query,
            toolTraces,
            'missing structured output',
          );
          if (synthesized && synthesized !== fullText) {
            fullText = synthesized;
            structured = assessStructuredOutput(fullText, structuredConfig);
          }
        }
        if (!structured.valid) {
          incomplete = true;
          console.warn(
            `[AgentFactory] Skill "${skill.name}" missing valid structured JSON — marking incomplete`,
          );
        } else {
          incomplete = false;
        }
      }

      let handoff = composeSkillHandoff(fullText, toolTraces, incomplete, skill.id, query);
      if (structuredConfig) {
        handoff = enrichHandoffWithStructuredOutput(handoff, structuredConfig, incomplete).handoff;
      }
      if (!handoff.trim()) {
        yield {
          type: 'error',
          data: `Skill ${skill.name} finished without text or tool output.`,
        };
        return;
      }
      yield { type: 'text_done', data: handoff };
    } catch (error: unknown) {
      if (isGraphRecursionError(error)) {
        skillEndedEarly = true;
        console.warn(
          `[AgentFactory] Skill "${skill.name}" GraphRecursionError — returning partial handoff`,
        );
      } else if (!isInferenceInterruptError(error)) {
        console.error(`[AgentFactory] Skill "${skill.name}" stream error:`, error);
      }
      let partial = composeSkillHandoff(fullText, toolTraces, true, skill.id, query);
      if (skill.structuredOutput) {
        partial = enrichHandoffWithStructuredOutput(partial, skill.structuredOutput, true).handoff;
      }
      if (partial.trim()) {
        console.warn(
          `[AgentFactory] Skill "${skill.name}" ended with error but returning ${toolTraces.length} tool trace(s): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        yield { type: 'text_done', data: partial };
        return;
      }
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[AgentFactory] Skill "${skill.name}" failed:`, errMsg);
      yield { type: 'error', data: `Skill ${skill.name} failed: ${errMsg}` };
    }
  }

  clearCache() {
    this.cache.clear();
  }
}
