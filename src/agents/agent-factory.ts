import { ChatOllama } from '@langchain/ollama';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
// @ts-ignore
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { SkillDefinition } from '../skills/base-skill';
import { StreamEvent } from './react-agent';
import { configManager } from '../config/index';

export class AgentFactory {
  private cache: Map<string, any> = new Map();

  /**
   * Build (or return cached) a compiled LangGraph agent for the given skill definition.
   */
  getAgent(skill: SkillDefinition): any {
    if (this.cache.has(skill.id)) {
      return this.cache.get(skill.id);
    }

    const config = configManager.getConfig();
    const llm = new ChatOllama({
      model: skill.model || config.llm.model,
      temperature: skill.temperature ?? config.llm.temperature,
    });

    const tools = skill.tools;
    const llmWithTools = tools.length > 0 ? llm.bindTools(tools) : llm;

    const callModel = async (state: typeof MessagesAnnotation.State) => {
      const response = await llmWithTools.invoke(state.messages);
      return { messages: [response] };
    };

    const toolNode = new ToolNode(tools);

    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      const messages = state.messages;
      const lastMessage = messages[messages.length - 1] as any;
      if (lastMessage.tool_calls?.length) return 'tools';
      return '__end__';
    };

    const workflow = new StateGraph(MessagesAnnotation)
      .addNode('agent', callModel)
      .addNode('tools', toolNode)
      .addEdge('__start__', 'agent')
      .addConditionalEdges('agent', shouldContinue)
      .addEdge('tools', 'agent');

    const compiled = workflow.compile();
    this.cache.set(skill.id, compiled);

    console.log(`[AgentFactory] Built agent for skill: ${skill.name}`);
    return compiled;
  }

  /**
   * Stream a skill agent's response, yielding StreamEvent objects.
   */
  async *runStream(skill: SkillDefinition, query: string): AsyncGenerator<StreamEvent> {
    console.log(`[AgentFactory] Running skill "${skill.name}" for: "${query.substring(0, 60)}..."`);

    yield { type: 'thinking', data: `Using skill: ${skill.name}...` };

    const graph = this.getAgent(skill);
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
          if (chunk?.content) {
            const token = chunk.content.toString();
            if (token) {
              fullText += token;
              yield { type: 'token', data: token };
            }
          }
        } else if (event.event === 'on_tool_start') {
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
