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

    const toolNode = new ToolNode(tools);

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

    try {
      const stream = graph.streamEvents(inputMessages, { version: 'v2' });

      for await (const event of stream) {
        if (event.event === 'on_chat_model_stream') {
          const chunk = event.data?.chunk;
          const hasToolCallChunks = chunk?.tool_call_chunks?.length > 0;
          if (chunk?.content && !hasToolCallChunks) {
            const token = chunk.content.toString();
            if (token) {
              fullText += token;
              yield { type: 'token', data: token };
            }
          }
        } else if (event.event === 'on_tool_start') {
          if (fullText) fullText = '';
          yield { type: 'tool_call', data: event.name || 'unknown' };
        }
      }

      yield { type: 'text_done', data: fullText };
    } catch (error: any) {
      console.error(`[AgentFactory] Skill "${skill.name}" failed:`, error.message);
      yield { type: 'error', data: `Skill ${skill.name} failed: ${error.message}` };
    }
  }

  clearCache() {
    this.cache.clear();
  }
}
