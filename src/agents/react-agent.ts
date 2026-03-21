import { ChatOllama } from '@langchain/ollama';
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';
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
  private conversationHistory: BaseMessage[] = [];
  private static readonly MAX_HISTORY_TURNS = 20;

  private static readonly BASE_SYSTEM_PROMPT = 
    "You are a helpful, concise AI voice assistant with access to tools. " +
    "If you need information or need to perform an action, use your tools. " +
    "Your final answer will be spoken aloud by a Text-to-Speech engine, " +
    "so please keep the final response brief, natural, and avoid markdown formatting.\n\n" +
    "MEMORY INSTRUCTIONS:\n" +
    "- When the user tells you their name, preferences, goals, important facts, or decisions, " +
    "use the store_memory tool to save them for future reference with appropriate tags " +
    "(e.g. ['user_preference'], ['user_name'], ['important_fact']).\n" +
    "- Relevant memories from past conversations will be provided to you as context at the start of each message.";

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

  private isMemoryEnabled(): boolean {
    return configManager.getConfig().memory?.enabled ?? true;
  }

  /**
   * If memory is enabled, searches long-term memory for context relevant to
   * the current input and appends it to the system prompt.
   */
  private async buildSystemPromptWithMemory(input: string | any): Promise<string> {
    const base = this.getSystemPrompt();
    if (!this.isMemoryEnabled()) return base;

    const query = typeof input === 'string' ? input : 'general user context';
    try {
      const memories = await this.mcpManager.searchMemory(query);
      if (memories) {
        console.log('[ReAct Agent] Injecting relevant memories into context.');
        return base + `\n\nRELEVANT MEMORIES FROM PAST CONVERSATIONS:\n${memories}`;
      }
    } catch { /* memory unavailable, proceed without it */ }

    return base;
  }

  /** Expose the MCP manager so the server can call memory operations directly. */
  getMcpManager(): MCPClientManager {
    return this.mcpManager;
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

  clearHistory() {
    this.conversationHistory = [];
    console.log('[ReAct Agent] Conversation history cleared.');
  }

  getHistoryLength(): number {
    return this.conversationHistory.length / 2;
  }

  private appendToHistory(humanInput: string | any, aiResponse: string) {
    const humanContent = typeof humanInput === 'string' ? humanInput : '[audio input]';
    this.conversationHistory.push(new HumanMessage({ content: humanContent }));
    this.conversationHistory.push(new AIMessage({ content: aiResponse }));

    // Trim to max turns (each turn = 2 messages)
    const maxMessages = ReactAgent.MAX_HISTORY_TURNS * 2;
    if (this.conversationHistory.length > maxMessages) {
      this.conversationHistory = this.conversationHistory.slice(this.conversationHistory.length - maxMessages);
    }
  }

  async process(input: string | any): Promise<string> {
    console.log(`[ReAct Agent] Thinking about input...`);
    
    try {
      const systemPrompt = await this.buildSystemPromptWithMemory(input);
      const result = await this.graph.invoke({
        messages: [new SystemMessage(systemPrompt), ...this.conversationHistory, new HumanMessage({ content: input })]
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
          const skillResponse = skillMessages[skillMessages.length - 1].content.toString();
          this.appendToHistory(input, skillResponse);
          return skillResponse;
        }
      }

      console.log(`[ReAct Agent] Final Response: "${content.substring(0, 80)}..."`);
      this.appendToHistory(input, content);
      return content;
      
    } catch (error: any) {
      return this.handleError(error);
    }
  }

  async *processStream(input: string | any, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    console.log(`[ReAct Agent] Streaming response for input...`);

    if (signal?.aborted) return;

    // Kick off memory search immediately — runs in parallel with the first yield
    const systemPromptPromise = this.buildSystemPromptWithMemory(input);

    yield { type: 'thinking', data: 'Processing your request...' };

    try {
      const systemPrompt = await systemPromptPromise;

      if (signal?.aborted) return;

      const inputMessages = {
        messages: [new SystemMessage(systemPrompt), ...this.conversationHistory, new HumanMessage({ content: input })]
      };

      let fullText = '';
      // When a tool is called the LLM may have already emitted text tokens
      // (e.g. "Let me look that up…"). We clear those so only the final
      // clean answer reaches the UI.
      let toolWasCalled = false;
      const stream = this.graph.streamEvents(inputMessages, { version: 'v2', signal });

      for await (const event of stream) {
        if (signal?.aborted) {
          console.log('[ReAct Agent] Stream aborted by client.');
          return;
        }

        if (event.event === 'on_chat_model_stream') {
          const chunk = event.data?.chunk;
          // Skip chunks that are building a tool call (no real text content)
          const hasToolCallChunks = chunk?.tool_call_chunks?.length > 0;
          if (chunk?.content && !hasToolCallChunks) {
            const token = chunk.content.toString();
            if (token) {
              fullText += token;
              yield { type: 'token', data: token };
            }
          }
        } else if (event.event === 'on_tool_start') {
          console.log(`[ReAct Agent] Tool call: ${event.name}`);
          // Discard any text the model streamed before deciding to call a tool
          if (fullText) fullText = '';
          yield { type: 'tool_call', data: event.name || 'unknown' };
          toolWasCalled = true;
        }
      }

      // Check if the main agent decided to route to a skill
      const route = this.parseSkillRoute(fullText);
      if (route) {
        const skill = this.skillRegistry.getSkill(route.skillId);
        if (skill && skill.enabled) {
          console.log(`[ReAct Agent] Routing to skill: ${skill.name}`);
          yield { type: 'thinking', data: `Using skill: ${skill.name}...` };

          fullText = '';
          for await (const skillEvent of this.agentFactory.runStream(skill, route.query)) {
            yield skillEvent;
            if (skillEvent.type === 'text_done') fullText = skillEvent.data;
            if (skillEvent.type === 'error') fullText = skillEvent.data;
          }

          if (fullText) this.appendToHistory(input, fullText);
          return;
        }
      }

      console.log(`[ReAct Agent] Stream complete: "${fullText.substring(0, 80)}..."`);
      if (fullText) this.appendToHistory(input, fullText);
      yield { type: 'text_done', data: fullText };

    } catch (error: any) {
      yield { type: 'error', data: this.handleError(error) };
    }
  }

  /**
   * Produce a short, spoken-word summary of `fullText` that directly answers
   * the user's original question.  Used when the full response is too long for
   * comfortable TTS playback.
   */
  async summarizeForAudio(userInput: string | any, fullText: string): Promise<string> {
    const question = typeof userInput === 'string' ? userInput : 'the user question';
    const prompt =
      `The user asked: "${question}"\n\n` +
      `Here is the full response:\n${fullText}\n\n` +
      `Summarize the above in 1–2 short sentences that directly answer the question. ` +
      `Write in a natural, conversational tone suitable for speech. No markdown, no bullet points.`;
    try {
      const result = await this.llm.invoke([new HumanMessage({ content: prompt })]);
      return result.content.toString().trim();
    } catch {
      // Fallback: first 400 chars of the full text
      return fullText.substring(0, 400);
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