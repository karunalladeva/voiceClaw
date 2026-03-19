import { ChatOllama } from '@langchain/ollama';
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
// @ts-ignore
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { MCPClientManager } from './mcp-client';
import { AgentFactory } from './agent-factory';
import { SkillRegistry } from '../skills/registry';
import { configManager } from '../config/index';

export interface StreamEvent {
  type: 'transcription' | 'thinking' | 'tool_call' | 'token' | 'text_done' | 'audio' | 'error' | 'done';
  data: string;
}

export class ReactAgent {
  private llm: ChatOllama;
  private mcpManager: MCPClientManager;
  private graph: any;
  private lastTools: DynamicStructuredTool[] = [];
  private skillRegistry: SkillRegistry;
  private agentFactory: AgentFactory;

  private static readonly BASE_SYSTEM_PROMPT = 
    "You are a helpful, concise AI voice assistant with access to tools. " +
    "If you need information or need to perform an action, use your tools. " +
    "Your final answer will be spoken aloud by a Text-to-Speech engine, " +
    "so please keep the final response brief, natural, and avoid markdown formatting.";

  constructor() {
    this.mcpManager = new MCPClientManager();
    this.skillRegistry = new SkillRegistry();
    this.agentFactory = new AgentFactory();
    this.llm = this.createLLM();
    
    configManager.on('configChanged', () => {
      console.log('[ReAct Agent] Configuration changed. Re-initializing...');
      this.llm = this.createLLM();
      this.agentFactory.clearCache();
      if (this.lastTools.length > 0 || this.graph) {
        this.compileGraph(this.lastTools);
      }
    });
  }

  private createLLM() {
    const config = configManager.getConfig();
    return new ChatOllama({
      model: config.llm.model,
      temperature: config.llm.temperature,
    });
  }

  async initialize(serverScriptPaths: string[]) {
    try {
      console.log('[ReAct Agent] Initializing...');
      
      // 1. Connect MCP servers
      for (let i = 0; i < serverScriptPaths.length; i++) {
        const p = serverScriptPaths[i];
        await this.mcpManager.connectLocalServer(`server_${i}`, p);
      }
      
      let tools = await this.mcpManager.loadTools();
      
      if (configManager.getConfig().agent?.enableInternet) {
        const { webSearchTool } = await import('../tools/search');
        tools.push(webSearchTool);
        console.log('[ReAct Agent] Internet search tool enabled.');
      }
      
      // Shell tool is always available on the main agent
      const { shellExecTool } = await import('../tools/shell');
      tools.push(shellExecTool);
      console.log('[ReAct Agent] Shell exec tool loaded.');
      
      this.lastTools = tools;
      this.compileGraph(tools);
      console.log('[ReAct Agent] MCP tools loaded:', tools.map(t => t.name).join(', '));

      // 2. Auto-discover skills
      await this.skillRegistry.discover();
      const skills = this.skillRegistry.getEnabledSkills();
      if (skills.length > 0) {
        console.log('[ReAct Agent] Skills available:', skills.map(s => s.name).join(', '));
      }
      
    } catch (err) {
      console.error('[ReAct Agent] Initialization failed. Running in graceful fallback mode.', err);
      this.lastTools = [];
      this.compileGraph([]);
    }
  }

  private getSystemPrompt(): string {
    const routingPrompt = this.skillRegistry.buildRoutingPrompt();
    return ReactAgent.BASE_SYSTEM_PROMPT + routingPrompt;
  }

  private compileGraph(tools: DynamicStructuredTool[]) {
    const llmWithTools = tools.length > 0 ? this.llm.bindTools(tools) : this.llm;

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

    this.graph = workflow.compile();
  }

  /**
   * Try to parse a skill routing response from the LLM.
   * Returns { skillId, query } if the LLM routed, or null if it answered directly.
   */
  private parseSkillRoute(text: string): { skillId: string; query: string } | null {
    try {
      const trimmed = text.trim();
      // Check if the response looks like a JSON routing instruction
      if (trimmed.startsWith('{') && trimmed.includes('route_to_skill')) {
        const parsed = JSON.parse(trimmed);
        if (parsed.route_to_skill && parsed.query) {
          return { skillId: parsed.route_to_skill, query: parsed.query };
        }
      }
    } catch {
      // Not JSON, agent answered directly
    }
    return null;
  }

  async process(input: string | any): Promise<string> {
    console.log(`[ReAct Agent] Thinking about input...`);
    
    try {
      const result = await this.graph.invoke({
        messages: [new SystemMessage(this.getSystemPrompt()), new HumanMessage({ content: input })]
      });

      const messages = result.messages;
      const lastMessage = messages[messages.length - 1];
      const content = lastMessage.content.toString();

      // Check if the agent wants to route to a skill
      const route = this.parseSkillRoute(content);
      if (route) {
        const skill = this.skillRegistry.getSkill(route.skillId);
        if (skill && skill.enabled) {
          console.log(`[ReAct Agent] Routing to skill: ${skill.name}`);
          const skillGraph = this.agentFactory.getAgent(skill);
          const skillResult = await skillGraph.invoke({
            messages: [new SystemMessage(skill.systemPrompt), new HumanMessage({ content: route.query })]
          });
          const skillMessages = skillResult.messages;
          return skillMessages[skillMessages.length - 1].content.toString();
        }
      }

      console.log(`[ReAct Agent] Final Response: "${content.substring(0, 80)}..."`);
      return content;
      
    } catch (error: any) {
      return this.handleError(error);
    }
  }

  async *processStream(input: string | any): AsyncGenerator<StreamEvent> {
    console.log(`[ReAct Agent] Streaming response for input...`);
    
    yield { type: 'thinking', data: 'Processing your request...' };

    try {
      const inputMessages = {
        messages: [new SystemMessage(this.getSystemPrompt()), new HumanMessage({ content: input })]
      };

      let fullText = '';
      const stream = this.graph.streamEvents(inputMessages, { version: 'v2' });

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
          console.log(`[ReAct Agent] Tool call: ${event.name}`);
          yield { type: 'tool_call', data: event.name || 'unknown' };
        }
      }

      // Check if the main agent decided to route to a skill
      const route = this.parseSkillRoute(fullText);
      if (route) {
        const skill = this.skillRegistry.getSkill(route.skillId);
        if (skill && skill.enabled) {
          console.log(`[ReAct Agent] Routing to skill: ${skill.name}`);
          // Clear the routing JSON from the chat - the user should see the skill's response instead
          yield { type: 'thinking', data: `Using skill: ${skill.name}...` };

          fullText = '';
          for await (const skillEvent of this.agentFactory.runStream(skill, route.query)) {
            yield skillEvent;
            if (skillEvent.type === 'text_done') fullText = skillEvent.data;
            if (skillEvent.type === 'error') fullText = skillEvent.data;
          }

          return;
        }
      }

      console.log(`[ReAct Agent] Stream complete: "${fullText.substring(0, 80)}..."`);
      yield { type: 'text_done', data: fullText };

    } catch (error: any) {
      yield { type: 'error', data: this.handleError(error) };
    }
  }

  getSkillRegistry(): SkillRegistry {
    return this.skillRegistry;
  }

  private handleError(error: any): string {
    console.error('[ReAct Agent] Processing failed:', error);
    if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      return "I cannot connect to my brain. Please start Ollama.";
    }
    if (error.message?.includes('Unsupported content type') || error.message?.includes('unknown format')) {
      return "The current AI model does not support direct audio input. Please switch the STT configuration back to Local Transcribe.";
    }
    return "I encountered an error while processing your request.";
  }
}