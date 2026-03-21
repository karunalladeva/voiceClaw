import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
// @ts-ignore
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { MCPClientManager } from './mcp-client';
import { AgentFactory } from './agent-factory';
import { SkillRegistry } from '../skills/registry';
import { configManager } from '../config/index';
import { modelRegistry } from '../models/model-registry';
import { modelRouter } from '../models/model-router';
import { learningEngine } from './learning-engine';

export interface StreamEvent {
  type: 'transcription' | 'thinking' | 'tool_call' | 'token' | 'text_done' | 'audio' | 'error' | 'done';
  data: string;
}

export class ReactAgent {
  private llm: BaseChatModel | null = null;
  private mcpManager: MCPClientManager;
  private graph: any;
  private lastTools: DynamicStructuredTool[] = [];
  private skillRegistry: SkillRegistry;
  private agentFactory: AgentFactory;
  private conversationHistory: BaseMessage[] = [];
  private static readonly MAX_HISTORY_TURNS = 20;

  private static readonly BASE_SYSTEM_PROMPT =
    'You are a helpful, concise AI voice assistant with access to tools. ' +
    'If you need information or need to perform an action, use your tools. ' +
    'Your final answer will be spoken aloud by a Text-to-Speech engine, ' +
    'so please keep the final response brief, natural, and avoid markdown formatting.\n\n' +
    'MEMORY INSTRUCTIONS:\n' +
    '- When the user tells you their name, preferences, goals, important facts, or decisions, ' +
    'use the store_memory tool to save them for future reference with appropriate tags ' +
    "(e.g. ['user_preference'], ['user_name'], ['important_fact']).\n" +
    '- Relevant memories from past conversations will be provided to you as context at the start of each message.';

  constructor() {
    this.mcpManager = new MCPClientManager();
    this.skillRegistry = new SkillRegistry();
    this.agentFactory = new AgentFactory();

    let _rebuilding = false;

    const rebuildModel = (label: string) => {
      if (_rebuilding) {
        console.log(`[ReAct Agent] Skipping ${label} rebuild — one already in progress.`);
        return;
      }
      _rebuilding = true;
      console.log(`[ReAct Agent] ${label} — reloading master model…`);
      modelRouter.invalidate();
      modelRouter
        .getMasterModel()
        .then((llm) => {
          this.llm = llm;
          this.agentFactory.clearCache();
          this.compileGraph(this.lastTools);
        })
        .catch((err) => console.error('[ReAct Agent] Failed to reload master model:', err))
        .finally(() => { _rebuilding = false; });
    };

    // When the model registry changes, rebuild the graph with the new master
    modelRegistry.on('changed', () => rebuildModel('Model registry changed'));

    // Config changes (e.g. temperature) also trigger a reload
    configManager.on('configChanged', () => {
      if (_rebuilding) return;
      _rebuilding = true;
      modelRouter.invalidate();
      modelRouter
        .getMasterModel()
        .then((llm) => {
          this.llm = llm;
          this.agentFactory.clearCache();
          if (this.lastTools.length > 0 || this.graph) {
            this.compileGraph(this.lastTools);
          }
        })
        .catch((err) => console.error('[ReAct Agent] Config reload error:', err))
        .finally(() => { _rebuilding = false; });
    });
  }

  async initialize(serverScriptPaths: string[]) {
    try {
      console.log('[ReAct Agent] Initializing…');

      // 1. Boot model registry (loads models-config.json, starts cap detection)
      await modelRegistry.initialize();

      // 2. Resolve master LLM
      this.llm = await modelRouter.getMasterModel();

      // 3. Connect MCP servers
      for (let i = 0; i < serverScriptPaths.length; i++) {
        await this.mcpManager.connectLocalServer(`server_${i}`, serverScriptPaths[i]);
      }

      let tools = await this.mcpManager.loadTools();

      if (configManager.getConfig().agent?.enableInternet) {
        const { webSearchTool, webFetchTool } = await import('../tools/search');
        tools.push(webSearchTool, webFetchTool);
        console.log('[ReAct Agent] Internet search + fetch tools enabled.');
      }

      const { shellExecTool } = await import('../tools/shell');
      tools.push(shellExecTool);
      console.log('[ReAct Agent] Shell exec tool loaded.');

      this.lastTools = tools;
      this.compileGraph(tools);
      console.log('[ReAct Agent] MCP tools loaded:', tools.map((t) => t.name).join(', '));

      // 4. Auto-discover skills
      await this.skillRegistry.discover();
      const skills = this.skillRegistry.getEnabledSkills();
      if (skills.length > 0) {
        console.log('[ReAct Agent] Skills available:', skills.map((s) => s.name).join(', '));
      }

      // 5. Load and watch learned skills (OpenClaw-style)
      await this.skillRegistry.loadLearnedSkills();
      this.skillRegistry.watchLearnedSkills();

      // 6. Warm up the model — AWAIT so the server only opens to traffic after
      //    Ollama has fully loaded the model into memory (prevents cold-start timeout).
      await this._warmUpModel();
    } catch (err) {
      console.error('[ReAct Agent] Initialization failed. Running in graceful fallback mode.', err);
      this.lastTools = [];
      this.compileGraph([]);
    }
  }

  private async _warmUpModel(): Promise<void> {
    try {
      if (!this.llm) return;
      console.log('[ReAct Agent] Warming up model (cold-start pre-load)…');
      await (this.llm as any).invoke([new HumanMessage({ content: 'hi' })]);
      console.log('[ReAct Agent] Model warm-up complete. (Ollama keep_alive=-1: model stays loaded indefinitely)');
    } catch {
      console.warn('[ReAct Agent] Model warm-up failed (model may load on first use).');
    }
  }


  // ── Graph compilation ──────────────────────────────────────────────────────

  private compileGraph(tools: DynamicStructuredTool[]) {
    if (!this.llm) {
      console.warn('[ReAct Agent] compileGraph called before LLM is ready — skipping.');
      return;
    }

    const llm = this.llm;
    const llmWithTools: any = tools.length > 0 ? (llm as any).bindTools(tools) : llm;

    const callModel = async (state: typeof MessagesAnnotation.State) => {
      const response = await llmWithTools.invoke(state.messages);
      return { messages: [response] };
    };

    const toolNode = new ToolNode(tools);

    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      const lastMessage = state.messages[state.messages.length - 1] as any;
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

  // ── System prompt / memory ─────────────────────────────────────────────────

  private getSystemPrompt(): string {
    return (
      ReactAgent.BASE_SYSTEM_PROMPT +
      this.skillRegistry.buildRoutingPrompt() +
      this.skillRegistry.getLearnedSkillsContext()
    );
  }

  private isMemoryEnabled(): boolean {
    return configManager.getConfig().memory?.enabled ?? true;
  }

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
    } catch { /* memory unavailable */ }

    return base;
  }

  // ── History management ─────────────────────────────────────────────────────

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

    const maxMessages = ReactAgent.MAX_HISTORY_TURNS * 2;
    if (this.conversationHistory.length > maxMessages) {
      this.conversationHistory = this.conversationHistory.slice(
        this.conversationHistory.length - maxMessages
      );
    }
  }

  // ── Skill routing ──────────────────────────────────────────────────────────

  private parseSkillRoute(text: string): { skillId: string; query: string } | null {
    try {
      const trimmed = text.trim();
      if (trimmed.startsWith('{') && trimmed.includes('route_to_skill')) {
        const parsed = JSON.parse(trimmed);
        if (parsed.route_to_skill && parsed.query) {
          return { skillId: parsed.route_to_skill, query: parsed.query };
        }
      }
    } catch { /* Not a routing JSON */ }
    return null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Expose MCP manager for server-side memory operations. */
  getMcpManager(): MCPClientManager {
    return this.mcpManager;
  }

  getSkillRegistry(): SkillRegistry {
    return this.skillRegistry;
  }

  /**
   * Produce a short, spoken-word summary of `fullText` that directly answers
   * the user's question. Uses the 'summarize' task route (fast model if configured,
   * otherwise master).
   */
  async summarizeForAudio(userInput: string | any, fullText: string): Promise<string> {
    const question = typeof userInput === 'string' ? userInput : 'the user question';
    const prompt =
      `The user asked: "${question}"\n\n` +
      `Full response:\n${fullText}\n\n` +
      `Summarize in 1–2 short sentences that directly answer the question. ` +
      `Conversational, natural for speech. No markdown, no bullet points.`;
    try {
      const llm = await modelRouter.getModel('summarize');
      const result = await (llm as any).invoke([new HumanMessage({ content: prompt })]);
      return result.content.toString().trim();
    } catch {
      return fullText.substring(0, 400);
    }
  }

  // ── Non-streaming process ──────────────────────────────────────────────────

  async process(input: string | any): Promise<string> {
    console.log('[ReAct Agent] Thinking about input…');

    try {
      const systemPrompt = await this.buildSystemPromptWithMemory(input);
      const result = await this.graph.invoke({
        messages: [
          new SystemMessage(systemPrompt),
          ...this.conversationHistory,
          new HumanMessage({ content: input }),
        ],
      });

      const lastMessage = result.messages[result.messages.length - 1];
      const content = lastMessage.content.toString();

      const route = this.parseSkillRoute(content);
      if (route) {
        const skill = this.skillRegistry.getSkill(route.skillId);
        if (skill?.enabled) {
          console.log(`[ReAct Agent] Routing to skill: ${skill.name}`);
          const skillGraph = this.agentFactory.getAgent(skill);
          const skillResult = await skillGraph.invoke({
            messages: [new SystemMessage(skill.systemPrompt), new HumanMessage({ content: route.query })],
          });
          const skillResponse = skillResult.messages[skillResult.messages.length - 1].content.toString();
          this.appendToHistory(input, skillResponse);
          return skillResponse;
        }
      }

      console.log(`[ReAct Agent] Final Response: "${content.substring(0, 80)}…"`);
      this.appendToHistory(input, content);
      return content;
    } catch (error: any) {
      return this.handleError(error);
    }
  }

  // ── Streaming process ──────────────────────────────────────────────────────

  async *processStream(input: string | any, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    console.log('[ReAct Agent] Streaming response for input…');

    if (signal?.aborted) return;

    const cfg = configManager.getConfig().learning ?? {};
    const maxRetries = cfg.retryOnFail ? (cfg.maxRetries ?? 3) : 0;
    const attemptHistory: Array<{ attempt: number; response: string }> = [];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Kick off memory search in parallel with the first yield
      const systemPromptPromise = this.buildSystemPromptWithMemory(input);

      if (attempt === 0) {
        yield { type: 'thinking', data: 'Processing your request…' };
      } else {
        yield { type: 'thinking', data: `Retrying... (attempt ${attempt + 1} of ${maxRetries + 1})` };
      }

      try {
        const systemPrompt = await systemPromptPromise;
        if (signal?.aborted) return;

        // Inject extra retry context on second+ attempt
        const retryPrefix = attempt > 0
          ? `\n\n[SELF-IMPROVEMENT] Previous attempt failed. Approach this differently. Attempt ${attempt + 1}.`
          : '';

        const inputMessages = {
          messages: [
            new SystemMessage(systemPrompt + retryPrefix),
            ...this.conversationHistory,
            new HumanMessage({ content: input }),
          ],
        };

        let fullText = '';
        let toolWasCalled = false;
        const stream = this.graph.streamEvents(inputMessages, { version: 'v2', signal });

        for await (const event of stream) {
          if (signal?.aborted) {
            console.log('[ReAct Agent] Stream aborted by client.');
            return;
          }

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
            console.log(`[ReAct Agent] Tool call: ${event.name}`);
            if (fullText) fullText = '';
            yield { type: 'tool_call', data: event.name || 'unknown' };
            toolWasCalled = true;
          }
        }

        // Check if the main agent decided to route to a skill
        const route = this.parseSkillRoute(fullText);
        if (route) {
          const skill = this.skillRegistry.getSkill(route.skillId);
          if (skill?.enabled) {
            console.log(`[ReAct Agent] Routing to skill: ${skill.name}`);
            yield { type: 'thinking', data: `Using skill: ${skill.name}…` };

            fullText = '';
            for await (const skillEvent of this.agentFactory.runStream(skill, route.query)) {
              yield skillEvent;
              if (skillEvent.type === 'text_done') fullText = skillEvent.data;
              if (skillEvent.type === 'error') fullText = skillEvent.data;
            }

            if (fullText) this.appendToHistory(input, fullText);
            // Auto-store memory for skill responses too
            if (cfg.autoMemoryStore && fullText) {
              learningEngine.autoExtractAndStore(input, fullText, this.mcpManager).catch(() => {});
            }
            return;
          }
        }

        // Check if we should retry
        if (attempt < maxRetries && learningEngine.shouldRetry(fullText)) {
          console.log(`[ReAct Agent] Response indicates failure. Attempting to learn… (attempt ${attempt + 1}/${maxRetries})`);
          attemptHistory.push({ attempt: attempt + 1, response: fullText });

          if (cfg.autoSkillCreate) {
            yield { type: 'thinking', data: 'Learning from failure and creating a skill…' };
            const inputStr = typeof input === 'string' ? input : '[audio input]';
            await learningEngine.createSkillFromFailure(inputStr, attemptHistory);
            // Reload learned skills so next attempt has updated context
            await this.skillRegistry.loadLearnedSkills();
          }
          // Continue to next loop iteration (retry)
          continue;
        }

        // Success path — commit history and auto-store
        console.log(`[ReAct Agent] Stream complete: "${fullText.substring(0, 80)}…"`);
        if (fullText) this.appendToHistory(input, fullText);

        if (cfg.autoMemoryStore && fullText) {
          learningEngine.autoExtractAndStore(input, fullText, this.mcpManager).catch(() => {});
        }

        yield { type: 'text_done', data: fullText };
        return; // Done — exit the retry loop
      } catch (error: any) {
        yield { type: 'error', data: this.handleError(error) };
        return;
      }
    }

    // All retries exhausted
    yield { type: 'text_done', data: 'I tried multiple approaches but could not complete your request. I have noted this for future learning.' };
  }

  // ── Error handling ─────────────────────────────────────────────────────────

  private handleError(error: any): string {
    console.error('[ReAct Agent] Processing failed:', error);
    if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      return 'I cannot connect to my brain. Please check that the model server is running.';
    }
    if (
      error.message?.includes('Unsupported content type') ||
      error.message?.includes('unknown format')
    ) {
      return 'The current AI model does not support direct audio input. Please switch the STT configuration back to Local Transcribe.';
    }
    return 'I encountered an error while processing your request.';
  }
}
