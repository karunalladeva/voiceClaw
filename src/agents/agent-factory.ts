import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
// @ts-ignore
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { SkillDefinition } from '../skills/base-skill';
import { StreamEvent } from './react-agent';
import { modelRegistry } from '../models/model-registry';
import { modelRouter } from '../models/model-router';
import { createProvider } from '../models/provider-factory';
import { truncateToolMessages, truncateToolOutput } from '../utils/tool-output-truncate';
import { getAgentRunContext, toTaskArtifactScope } from './agent-run-context';
import { persistTaskResponse } from '../orchestration/task-response-store';
import { agentEvents } from '../admin/agent-events';
import { isInferenceInterruptError } from '../utils/inference-interrupt';

const SKILL_RECURSION_LIMIT = 20;
/** Skills may queue several Playwright fetches after web_search (lock + browser launch). */
const SKILL_RUN_TIMEOUT_MS = 300_000;
const SKILL_TOOL_APPENDIX_MAX_CHARS = 6000;
/** Default caps; ebook-validation-engine allows more fetches after search. */
const SKILL_MAX_WEB_SEARCH_CALLS = 6;
const SKILL_MAX_WEB_FETCH_CALLS = 3;

function getSkillToolLimits(skillId: string): { maxSearch: number; maxFetch: number } {
  if (skillId === 'ebook-validation-engine') {
    return { maxSearch: 6, maxFetch: 5 };
  }
  return { maxSearch: SKILL_MAX_WEB_SEARCH_CALLS, maxFetch: SKILL_MAX_WEB_FETCH_CALLS };
}

export interface SkillRunEmitOptions {
  chatId?: string;
  agentId?: string;
  parentAgentId?: string;
}

type SkillToolTrace = { name: string; output: string };

export function extractToolOutputFromEvent(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const output = (data as { output?: unknown }).output;
  if (typeof output === 'string') return output;
  if (output == null) return '';
  if (typeof output === 'object' && 'content' in (output as object)) {
    const content = (output as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((block: { text?: string }) => block?.text ?? '').join('');
    }
  }
  return String(output);
}

export const SKILL_RUN_INCOMPLETE_MARKER = '[SKILL_RUN_INCOMPLETE]';

/** Build handoff text for org agent — never drop successful tool output when the model skips a summary. */
export function composeSkillHandoff(
  assistantText: string,
  toolTraces: SkillToolTrace[],
  incomplete = false,
): string {
  const text = assistantText.trim();
  let body = text;
  if (toolTraces.length > 0) {
    const appendix = toolTraces
      .map(
        (trace, index) =>
          `### ${index + 1}. ${trace.name}\n${truncateToolOutput(trace.output, SKILL_TOOL_APPENDIX_MAX_CHARS)}`,
      )
      .join('\n\n');
    if (text.length >= 80) {
      body = `${text}\n\n--- Skill tool outputs (for orchestration) ---\n${appendix}`;
    } else {
      body = appendix;
    }
  }
  if (!incomplete) return body;
  return (
    `${SKILL_RUN_INCOMPLETE_MARKER} Skill stopped early (tool limit or timeout) — orchestrator must NOT treat as finished; retry on next heartbeat or delegate with partial data only.\n\n` +
    body
  );
}

export class AgentFactory {
  private cache: Map<string, any> = new Map();

  /**
   * Build (or return cached) a compiled LangGraph agent for the given skill.
   * If the skill names a specific modelId that exists in the registry, that
   * model is used; otherwise the master model is used.
   */
  async getAgentAsync(skill: SkillDefinition): Promise<any> {
    if (this.cache.has(skill.id)) return this.cache.get(skill.id)!;

    let llm: BaseChatModel;

    // Try skill-specified model first
    if (skill.model) {
      // Check if it looks like a registry ID
      const byId = modelRegistry.getById(skill.model);
      if (byId) {
        llm = (await modelRouter.getById(skill.model))!;
      } else {
        // Treat it as an Ollama model name (backward compat)
        const { ChatOllama } = await import('@langchain/ollama');
        llm = new ChatOllama({
          model: skill.model,
          temperature: skill.temperature ?? 0.2,
        }) as unknown as BaseChatModel;
      }
    } else {
      llm = await modelRouter.getMasterModel();
    }

    const compiled = this.buildGraph(llm, skill);
    this.cache.set(skill.id, compiled);
    console.log(`[AgentFactory] Built agent for skill: ${skill.name}`);
    return compiled;
  }

  /**
   * Synchronous façade kept for backward compatibility with existing callers.
   * Returns a cached graph or schedules a build and returns a lazy placeholder.
   */
  getAgent(skill: SkillDefinition): any {
    if (this.cache.has(skill.id)) return this.cache.get(skill.id)!;
    // Trigger async build; callers that need the graph should prefer getAgentAsync
    this.getAgentAsync(skill).catch((err) =>
      console.error(`[AgentFactory] Async build failed for ${skill.id}:`, err)
    );
    return this.cache.get(skill.id) ?? null;
  }

  // ── Internal graph builder ─────────────────────────────────────────────────

  private buildGraph(llm: BaseChatModel, skill: SkillDefinition): any {
    const tools = skill.tools;
    const llmWithTools: any = tools.length > 0 ? (llm as any).bindTools(tools) : llm;

    const callModel = async (state: typeof MessagesAnnotation.State) => {
      const response = await llmWithTools.invoke(state.messages);
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

  // ── Streaming ──────────────────────────────────────────────────────────────

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
    const { maxSearch, maxFetch } = getSkillToolLimits(skill.id);
    let webSearchCount = 0;
    let webFetchCount = 0;
    let skillEndedEarly = false;
    const deadline = Date.now() + SKILL_RUN_TIMEOUT_MS;

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
            break;
          }
          if (event.event === 'on_tool_start' && event.name === 'web_search') {
            webSearchCount += 1;
            if (webSearchCount > maxSearch) {
              console.warn(
                `[AgentFactory] Skill "${skill.name}" hit web_search limit (${maxSearch}) — stopping stream`,
              );
              skillEndedEarly = true;
              break;
            }
          }
          if (event.event === 'on_tool_start' && event.name === 'web_fetch' && maxFetch > 0) {
            webFetchCount += 1;
            if (webFetchCount > maxFetch) {
              console.warn(
                `[AgentFactory] Skill "${skill.name}" hit web_fetch limit (${maxFetch}) — stopping stream`,
              );
              skillEndedEarly = true;
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
                const content = messages[i]?.content;
                const text =
                  typeof content === 'string'
                    ? content
                    : Array.isArray(content)
                      ? content.map((block: { text?: string }) => block?.text ?? '').join('')
                      : '';
                if (text.trim()) {
                  fullText = text;
                  break;
                }
              }
            }
          }
        }
      } finally {
        try {
          await streamIterator.return?.();
        } catch (closeErr: unknown) {
          if (!isInferenceInterruptError(closeErr)) {
            console.warn(`[AgentFactory] Skill "${skill.name}" stream close:`, closeErr);
          }
        }
      }

      const handoff = composeSkillHandoff(fullText, toolTraces, skillEndedEarly);
      if (!handoff.trim()) {
        yield {
          type: 'error',
          data: `Skill ${skill.name} finished without text or tool output.`,
        };
        return;
      }
      yield { type: 'text_done', data: handoff };
    } catch (error: any) {
      if (!isInferenceInterruptError(error)) {
        console.error(`[AgentFactory] Skill "${skill.name}" stream error:`, error);
      }
      const partial = composeSkillHandoff(fullText, toolTraces, true);
      if (partial.trim()) {
        console.warn(
          `[AgentFactory] Skill "${skill.name}" ended with error but returning ${toolTraces.length} tool trace(s): ${error.message}`,
        );
        yield { type: 'text_done', data: partial };
        return;
      }
      console.error(`[AgentFactory] Skill "${skill.name}" failed:`, error.message);
      yield { type: 'error', data: `Skill ${skill.name} failed: ${error.message}` };
    }
  }

  clearCache() {
    this.cache.clear();
  }
}
