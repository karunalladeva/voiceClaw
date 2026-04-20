import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

// @ts-ignore
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { MCPClientManager } from './mcp-client';
import { AgentFactory } from './agent-factory';
import { SkillRegistry } from '../skills/registry';
import { configManager } from '../config/index';
import { modelRegistry } from '../models/model-registry';
import { modelRouter } from '../models/model-router';
import { learningEngine } from './learning-engine';
import { cache } from '../utils/cache';


import { historyManager } from './agent-history';

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
  private activeModelId: string = 'unknown';
  private static readonly MAX_HISTORY_TURNS = 3;

  private static readonly MAX_HISTORY_TOKENS = 8000; // ~32k characters (Standard for Mistral/Llama3/Qwen)



  // ── Cache TTLs (matching OpenClaw) ────────────────────────────────────────
  private static readonly MEMORY_CACHE_TTL = 5 * 60 * 1000;   // 5 mins
  private static readonly RESPONSE_CACHE_TTL = 2 * 60 * 1000; // 2 mins



  private getBaseSystemPrompt(): string {
    const config = configManager.getConfig();
    const name = config.assistantName || 'Claw';

    return `
<identity>
You are a helpful, concise AI voice assistant. Your name is ${name}.
If you need information or need to perform an action, use your tools.
</identity>

<rules>
1. TTS OUTPUT: Your final answer will be spoken aloud by a Text-to-Speech engine. Keep responses brief, natural, and avoid markdown formatting.
2. VOICE & PERSONALITY: You MUST understand and support SLANG, informal language, and cultural references fluently. Adapt your tone to match the user's level of formality. Never use bullet points in your final response.
3. VISION ENTRITLEMENT (CRITICAL): You DO have access to the user's screen via the native JSON tool named "route_to_skill" (skillId: "screen-reader"). NEVER say you cannot see the screen or lack access. ALWAYS prioritize using the screen-reader skill if the context might be visible on their display.
4. MEMORY INSTRUCTIONS: When the user tells you their preferences, goals, facts, or decisions, use the store_memory tool to save them for future reference. ALWAYS check provided memories first before asking for information.
</rules>`;
  }




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
          this.activeModelId = modelRegistry.getMaster()?.id || 'unknown';
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
      const masterConfig = modelRegistry.getMaster();
      this.activeModelId = masterConfig?.id || 'unknown';
      this.llm = await modelRouter.getMasterModel();


      // 3. Connect MCP servers
      for (let i = 0; i < serverScriptPaths.length; i++) {
        await this.mcpManager.connectLocalServer(`server_${i}`, serverScriptPaths[i]);
      }

      let tools = await this.mcpManager.loadTools();

      // 4. Dynamically load native tools via dedicated loader
      const { loadNativeTools } = await import('../loaders/tool-loader');
      const enableInternet = configManager.getConfig().agent?.enableInternet ?? true;
      const nativeTools = await loadNativeTools(enableInternet);
      tools.push(...nativeTools);

      // 4. Auto-discover skills
      await this.skillRegistry.discover();
      const skills = this.skillRegistry.getEnabledSkills();
      if (skills.length > 0) {
        console.log('[ReAct Agent] Skills available:', skills.map((s) => s.name).join(', '));
      }

      // 5. Load and watch learned skills (OpenClaw-style)
      await this.skillRegistry.loadLearnedSkills();
      this.skillRegistry.watchLearnedSkills();

      // 6. Finalize tool set and compile the graph now that skills exist
      this.lastTools = tools;
      this.compileGraph(tools);

      const allCoreTools = [...tools, ...this.getSystemTools()];
      console.log(`[ReAct Agent] Master Toolkit dynamically initialized with ${allCoreTools.length} tools:`, allCoreTools.map((t) => t.name).join(', '));
      console.log('[ReAct Agent] (Note: Specialized OS and App tools are lazy-loaded by their respective localized Skill Agents)');


      // 6. Warm up the model — AWAIT so the server only opens to traffic after
      //    Ollama has fully loaded the model into memory (prevents cold-start timeout).
      await this._warmUpModel();
    } catch (err) {
      const modelId = this.activeModelId;
      console.error(`[Agent: ReAct] [Model: ${modelId}] Initialization failed. Running in graceful fallback mode.`, err);
      this.lastTools = [];
      this.compileGraph([]);
    }

  }

  private async _warmUpModel(): Promise<void> {
    try {
      if (!this.llm) return;
      const modelId = this.activeModelId;
      console.log(`[Agent: ReAct] [Model: ${modelId}] Warming up model (cold-start pre-load)…`);
      await (this.llm as any).invoke([new HumanMessage({ content: 'hi' })]);
      console.log(`[Agent: ReAct] [Model: ${modelId}] Model warm-up complete. (Ollama keep_alive=-1: model stays loaded indefinitely)`);
    } catch {
      const modelId = this.activeModelId;
      console.warn(`[Agent: ReAct] [Model: ${modelId}] Model warm-up failed (model may load on first use).`);
    }

  }


  private getSystemTools(): DynamicStructuredTool[] {
    const validSkills = this.skillRegistry.getEnabledSkills().map(s => s.id).join(', ');

    return [
      new DynamicStructuredTool({
        name: 'route_to_skill',
        description: `CRITICAL: Call this function directly! DO NOT use shell_exec or python. Route the request to a specialized skill agent. Available skill IDs: [${validSkills}]. Use this to read the screen or delegate tasks.`,
        schema: z.object({
          skillId: z.string().describe(`The exact ID of the skill to trigger. Must be one of: ${validSkills}`),
          query: z.string().describe('The specific natural language instruction for the skill')
        }),
        func: async ({ skillId, query }, runManager, config) => {
          const skill = this.skillRegistry.getSkill(skillId);
          if (!skill || !skill.enabled) return `Skill ${skillId} not found or disabled.`;

          console.log(`[Agent: Skill (${skill.name})] Executing nested sub-graph logic...`);
          let finalOutput = '';

          try {
            // We use runStream natively. To prevent visual UI freezes, we map custom 'token' events 
            // from the sub-graph onto the custom callback manager or stdout. 
            // Full integration with LangGraph nested callback tracing handles context.
            for await (const skillEvent of this.agentFactory.runStream(skill, query)) {
              if (skillEvent.type === 'text_done' || skillEvent.type === 'error') {
                finalOutput = skillEvent.data;
              }
            }
          } catch (e: any) {
            finalOutput = `Skill crashed: ${e.message}`;
          }

          return `[Sub-Agent Result from ${skill.name}]:\n${finalOutput || 'No text output produced.'}`;
        }
      })
    ];
  }


  // ── Graph compilation ──────────────────────────────────────────────────────

  private compileGraph(tools: DynamicStructuredTool[]) {
    if (!this.llm) {
      console.warn('[ReAct Agent] compileGraph called before LLM is ready — skipping.');
      return;
    }

    const llm = this.llm;
    const sysTools = this.getSystemTools();
    const allTools = [...tools, ...sysTools];
    const llmWithTools: any = allTools.length > 0 ? (llm as any).bindTools(allTools) : llm;

    const callModel = async (state: typeof MessagesAnnotation.State) => {
      // ── Phase 2: Rolling Vision Context Manager ──
      // Prevent OOM by ensuring only the single most recent screenshot is sent to the local LLM per turn.
      let hasRetainedImage = false;

      const optimizedMessages = [...state.messages].reverse().map((msg: any) => {
        if (Array.isArray(msg.content)) {
          let modified = false;
          const optimizedContent = msg.content.map((block: any) => {
            if (block.type === 'image_url') {
              if (!hasRetainedImage) {
                hasRetainedImage = true;
                return block; // Keep the newest
              } else {
                modified = true;
                return { type: 'text', text: '\n[System: Prior screenshot automatically evicted from context window to preserve VRAM]\n' };
              }
            }
            return block;
          });

          if (modified) {
            const Ctor = msg.constructor;
            return new Ctor({ ...msg, content: optimizedContent });
          }
        }
        return msg;
      }).reverse();

      const response = await llmWithTools.invoke(optimizedMessages);
      return { messages: [response] };
    };

    // ── Tool Node with Summarization (Noise Reduction) ────────────────────────
    // We pass allTools here so ToolNode knows how to execute route_to_skill natively!
    const toolNodeWithTruncation = async (state: typeof MessagesAnnotation.State) => {
      const output = await new ToolNode(allTools).invoke(state);
      // Prune massive tool results for the current turn to avoid single-turn overflow
      for (const msg of output.messages) {
        if (msg.content && msg.content.length > 12000) {
          const modelId = this.activeModelId;
          console.warn(`[Agent: ReAct] [Model: ${modelId}] Summarizing massive tool output: ${msg.content.substring(0, 50)}…`);

          try {
            const fastModel = await modelRouter.getModel('summarize');
            const summary = await Promise.race([
              (fastModel as any).invoke([
                new SystemMessage("You are an expert at summarizing massive tool/command outputs. Summarize the following output accurately to retain all crucial details, keeping it under 2000 characters. Make the summary fast and concise."),
                new HumanMessage({ content: msg.content.substring(0, 40000) })
              ]),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Summarization Timeout')), 60000))
            ]);
            msg.content = `[Tool Output Summarized for Context Efficiency]:\n${(summary as any).content.toString()}`;
          } catch (e) {
            console.warn(`[Agent: ReAct] Summarizer failed or timed out, falling back to truncation:`, e);
            msg.content = msg.content.substring(0, 12000) + '\n\n...[OUTPUT TRUNCATED FOR CONTEXT EFFICIENCY]...';
          }
        }
      }

      return output;
    };

    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      const lastMessage = state.messages[state.messages.length - 1] as any;
      if (lastMessage.tool_calls?.length) return 'tools';
      return '__end__';
    };

    const workflow = new StateGraph(MessagesAnnotation)
      .addNode('agent', callModel)
      .addNode('tools', toolNodeWithTruncation)
      .addEdge('__start__', 'agent')
      .addConditionalEdges('agent', shouldContinue)
      .addEdge('tools', 'agent');



    this.graph = workflow.compile();
  }

  // ── System prompt / memory ─────────────────────────────────────────────────

  private getSystemPrompt(): string {
    return (
      this.getBaseSystemPrompt() +
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

    const query = typeof input === 'string' ? input.trim().toLowerCase() : 'general user context';

    // ── Memory Relevance Optimization ──────────────────────────────────────
    // Don't pollute context with past memories for extremely short fillers
    if (query.split(' ').length < 2 && !query.includes('?')) {
      return base;
    }


    const cacheKey = `mem:${query}`;


    // ── Memory Cache Check ───────────────────────────────────────────────────
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log('[ReAct Agent] Injecting cached memories into context.');
      return base + (cached ? `\n\n<memory>\n${cached}\n</memory>` : '');
    }

    try {
      const memories = await this.mcpManager.searchMemory(query);
      await cache.set(cacheKey, memories || '', ReactAgent.MEMORY_CACHE_TTL);
      if (memories) {
        console.log('[ReAct Agent] Injecting fresh memories into context.');
        return base + `\n\n<memory>\n${memories}\n</memory>`;
      }
    } catch { /* memory unavailable, store empty result to avoid retry spam */
      await cache.set(cacheKey, '', ReactAgent.MEMORY_CACHE_TTL);
    }


    return base;
  }

  // ── History management ─────────────────────────────────────────────────────

  async clearHistory(chatId: string = 'default') {
    await historyManager.deleteChat(chatId);
    await cache.clear();
    console.log(`[ReAct Agent] Chat ${chatId} history and caches cleared.`);
  }

  async getHistoryLength(chatId: string = 'default'): Promise<number> {
    return await historyManager.getHistoryLength(chatId);
  }

  private async appendToHistory(chatId: string, humanInput: string | any, aiResponse: string) {
    let humanContent = '[audio input]';

    if (typeof humanInput === 'string') {
      humanContent = humanInput;
    } else if (Array.isArray(humanInput)) {
      const textPart = humanInput.find(p => p.type === 'text');
      if (textPart && textPart.text) {
        humanContent = textPart.text;
      }
    }

    const thread = await historyManager.loadChat(chatId);
    thread.push(new HumanMessage({ content: humanContent }));
    thread.push(new AIMessage({ content: aiResponse }));

    const maxMessages = ReactAgent.MAX_HISTORY_TURNS * 2;
    if (thread.length > maxMessages) {
      const removed = thread.splice(0, thread.length - maxMessages);
      const removedText = removed.map(m => `${m.getType().toUpperCase()}: ${m.content}`).join('\\n');

      // Find and extract existing rolling summary
      const existingSummaryIndex = thread.findIndex(m => m.getType() === 'system' && m.content.toString().startsWith('[Conversation Summary]:'));
      const existingSummaryText = existingSummaryIndex >= 0 ? thread[existingSummaryIndex].content : '';
      if (existingSummaryIndex >= 0) thread.splice(existingSummaryIndex, 1);

      // Fire-and-forget background summarizer
      modelRouter.getModel('summarize').then(fastModel => {
        console.log(`[ReAct Agent] Background summarization running on ${removed.length} dropped history messages...`);
        return fastModel.invoke([
          new SystemMessage("Summarize the following conversation history briefly. Merge it with any previous summary to ensure critical long-term context is retained. Be concise."),
          new HumanMessage({ content: `Previous Summary: ${existingSummaryText}\\n\\nOlder Messages to summarize:\\n${removedText}` })
        ]);
      }).then(res => {
        const newSummaryMsg = new SystemMessage({ content: `[Conversation Summary]:\\n${res.content}` });
        const currentThread = historyManager.getThread(chatId);
        // Prepend summary to keep it in context
        currentThread.unshift(newSummaryMsg);
        historyManager.saveChat(chatId);
        console.log(`[ReAct Agent] History summarization complete.`);
      }).catch(err => console.warn('[History Summarizer] Failed to summarize dropped context:', err));

      historyManager.setThread(chatId, thread);
    }

    await historyManager.saveChat(chatId, typeof humanInput === 'string' ? humanInput : undefined);
  }



  // ── Public API ─────────────────────────────────────────────────────────────

  /** Expose MCP manager for server-side memory operations. */
  getMcpManager(): MCPClientManager {
    return this.mcpManager;
  }

  getSkillRegistry(): SkillRegistry {
    return this.skillRegistry;
  }



  // ── Non-streaming process ──────────────────────────────────────────────────

  async process(input: string | any, chatId: string = 'default'): Promise<string> {
    const modelId = this.activeModelId;
    console.log(`[Agent: ReAct] [Model: ${modelId}] Thinking about input…`);


    try {
      const systemPrompt = await this.buildSystemPromptWithMemory(input);
      const thread = await historyManager.loadChat(chatId);
      const result = await this.graph.invoke({
        messages: [
          new SystemMessage(systemPrompt),
          ...thread,
          new HumanMessage({ content: input }),
        ],
      }, { recursionLimit: 100 });

      const lastMessage = result.messages[result.messages.length - 1];
      const content = lastMessage.content.toString();

      // Check for tool calls (route_to_skill)
      if (lastMessage.tool_calls?.length) {
        for (const tc of lastMessage.tool_calls) {
          if (tc.name === 'route_to_skill') {
            const skill = this.skillRegistry.getSkill(tc.args.skillId);
            if (skill?.enabled) {
              console.log(`[ReAct Agent] Routing to skill: ${skill.name}`);
              const skillGraph = this.agentFactory.getAgent(skill);
              const skillResult = await skillGraph.invoke({
                messages: [new SystemMessage(skill.systemPrompt), new HumanMessage({ content: tc.args.query })],
              });
              const skillResponse = skillResult.messages[skillResult.messages.length - 1].content.toString();
              await this.appendToHistory(chatId, input, skillResponse);
              return skillResponse;
            }
          }
        }
      }

      console.log(`[ReAct Agent] Final Response: "${content.substring(0, 80)}…"`);
      await this.appendToHistory(chatId, input, content);
      return content;
    } catch (error: any) {
      return this.handleError(error);
    }
  }

  // ── Streaming process ──────────────────────────────────────────────────────

  async *processStream(input: string | any, chatId: string = 'default', signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const rawKey = typeof input === 'string' ? input.trim().toLowerCase() : '[audio]';
    const numTurns = await historyManager.getHistoryLength(chatId);
    const cacheKey = `resp:${rawKey}|hist:${numTurns}|chat:${chatId}`;
    const cachedResponse = await cache.get(cacheKey);

    if (cachedResponse) {
      console.log(`[ReAct Agent] Cache hit for: "${rawKey}"`);
      yield { type: 'thinking', data: 'Retrieving cached response…' };
      // Stream cached response in chunks to simulate real streaming speed
      const tokens = cachedResponse.split(' ');
      for (const token of tokens) {
        yield { type: 'token', data: token + ' ' };
      }
      yield { type: 'text_done', data: cachedResponse };
      return;
    }


    const modelId = this.activeModelId;
    console.log(`[Agent: ReAct] [Model: ${modelId}] Streaming response for input…`);

    const cfg = configManager.getConfig().learning ?? {};

    // ── Traffic Controller: Fast-Path Routing ──
    if (typeof input === 'string') {
      const lowerInput = input.trim().toLowerCase();
      if (lowerInput === 'what time is it?' || lowerInput === 'what time is it') {
        const msg = `It is currently ${new Date().toLocaleTimeString()}.`;
        yield { type: 'text_done', data: msg };
        return;
      }
      if (lowerInput === 'what is today?' || lowerInput === 'what is today' || lowerInput === 'what date is it?' || lowerInput === 'what date is it') {
        const msg = `Today is ${new Date().toLocaleDateString()}.`;
        yield { type: 'text_done', data: msg };
        return;
      }
    }

    // ── Traffic Controller: Macro Bypass Execution ──
    if (typeof input === 'string') {
      const macro = await learningEngine.matchMacro(input);
      if (macro) {
        console.log(`[ReAct Agent] Macro matched: ${macro.name}`);
        yield { type: 'thinking', data: `Executing learned Macro shortcut: ${macro.name}…` };

        const allCoreTools = [...(this.lastTools || []), ...this.getSystemTools()];
        for (const step of macro.steps) {
          const tool = allCoreTools.find(t => t.name === step.tool);
          if (tool) {
            yield { type: 'thinking', data: `Macro executing step: [${step.tool}]…` };
            try {
              await tool.invoke(step.args);
            } catch (e: any) {
              console.warn(`[Macro Execution] Step failed: ${e.message}`);
            }
          }
        }

        const successMsg = `Successfully executed deterministic macro shortcut: ${macro.name}`;
        await this.appendToHistory(chatId, input, successMsg);
        yield { type: 'text_done', data: successMsg };
        return;
      }
    }

    const maxRetries = cfg.retryOnFail ? (cfg.maxRetries ?? 3) : 0;
    const attemptHistory: Array<{ attempt: number; response: string }> = [];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Kick off memory search in parallel with the first yield
      const systemPromptPromise = this.buildSystemPromptWithMemory(input);

      // Only show "Thinking" if it's a retry or after a short delay to avoid flicker
      if (attempt > 0) {
        yield { type: 'thinking', data: `Retrying... (attempt ${attempt + 1} of ${maxRetries + 1})` };
      }


      try {
        const systemPrompt = await systemPromptPromise;
        if (signal?.aborted) return;

        // ── Context Fragmentation Fix: Move Base64 Images to Cache ──
        let processedInput = input;
        if (Array.isArray(input)) {
          processedInput = await Promise.all(input.map(async (block: any) => {
            if (block.type === 'image_url' && block.image_url?.url?.startsWith('data:')) {
              const match = block.image_url.url.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
              if (match) {
                const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
                const base64Data = match[2];
                const cacheDir = path.join(process.cwd(), 'workspace', 'cache');
                await fs.mkdir(cacheDir, { recursive: true }).catch(() => { });
                const filename = `vision_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
                const filepath = path.join(cacheDir, filename);
                await fs.writeFile(filepath, base64Data, 'base64');
                return { type: 'image_url', image_url: { url: `file://${filepath.replace(/\\/g, '/')}` } };
              }
            }
            return block;
          }));
        }

        // Inject extra retry context on second+ attempt
        const retryPrefix = attempt > 0
          ? `\n\n[SELF-IMPROVEMENT] Previous attempt failed. Approach this differently. Attempt ${attempt + 1}.`
          : '';

        const threadMsgs = await historyManager.loadChat(chatId);
        const inputMessages = {
          messages: [
            new SystemMessage(systemPrompt + retryPrefix),
            ...threadMsgs,
            new HumanMessage({ content: processedInput }),
          ],
        };

        let fullText = '';
        let inThinkingBlock = false;
        let thinkingBuffer = '';
        const toolTrace: Array<{ tool: string; args: any }> = [];

        console.log('Input messages:', inputMessages);
        let toolWasCalled = false;
        const stream = this.graph.streamEvents(inputMessages, { version: 'v2', signal, recursionLimit: 100 });

        for await (const event of stream) {
          if (signal?.aborted) {
            console.log('[ReAct Agent] Stream aborted by client.');
            return;
          }

          if (event.event === 'on_chat_model_stream') {
            const chunk = event.data?.chunk;

            // Stream 'thinking' capability if model provides reasoning natively
            if (chunk?.additional_kwargs?.reasoning_content) {
              const thought = chunk.additional_kwargs.reasoning_content.toString();
              if (thought) yield { type: 'thinking', data: thought };
            }

            const hasToolCallChunks = chunk?.tool_call_chunks?.length > 0;
            if (chunk?.content && !hasToolCallChunks) {
              let token = chunk.content.toString();

              if (token.includes('<think>')) {
                inThinkingBlock = true;
                token = token.replace('<think>', '');
              }

              if (inThinkingBlock) {
                if (token.includes('</think>')) {
                  inThinkingBlock = false;
                  const parts = token.split('</think>');
                  thinkingBuffer += parts[0];
                  yield { type: 'thinking', data: thinkingBuffer.trim() };
                  thinkingBuffer = ''; // reset
                  if (parts[1]) {
                    fullText += parts[1];
                    yield { type: 'token', data: parts[1] };
                  }
                } else {
                  thinkingBuffer += token;
                  // Periodically yield so UI knows it's thinking
                  if (thinkingBuffer.length % 20 === 0) {
                    yield { type: 'thinking', data: thinkingBuffer.substring(Math.max(0, thinkingBuffer.length - 80)).trim() + '...' };
                  }
                }
              } else {
                if (token) {
                  fullText += token;
                  yield { type: 'token', data: token };
                }
              }
            }
          } else if (event.event === 'on_tool_start') {
            const modelId = this.activeModelId;
            console.log(`[Agent: ReAct] [Model: ${modelId}] Tool call: ${event.name}`);

            if (event.name === 'route_to_skill') {
              const toolInput = event.data?.input;
              const skill = this.skillRegistry.getSkill(toolInput?.skillId);
              if (skill?.enabled) {
                console.log(`[Agent: Skill (${skill.name})] Routing to specialized skill natively...`);
                yield { type: 'thinking', data: `Delegating to Sub-Agent: ${skill.name}…` };
              }
            } else {
              // Record all actual tool calls for potential Macro Extraction later
              toolTrace.push({ tool: event.name || 'unknown', args: event.data?.input });
            }

            if (fullText) fullText = '';
            yield { type: 'tool_call', data: event.name || 'unknown' };
            toolWasCalled = true;
          }

        }

        // NO LONGER NEED parseSkillRoute HERE AS WE INTERCEPT IT ABOVE

        // Check if we should retry
        if (attempt < maxRetries && learningEngine.shouldRetry(fullText)) {
          const modelId = this.activeModelId;
          console.log(`[Agent: ReAct] [Model: ${modelId}] Response indicates failure. Attempting to learn… (attempt ${attempt + 1}/${maxRetries})`);
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
        if (fullText) {
          await this.appendToHistory(chatId, input, fullText);
          const rawKey = typeof input === 'string' ? input.trim().toLowerCase() : '[audio]';
          const nt = await historyManager.getHistoryLength(chatId);
          const cacheKey = `resp:${rawKey}|hist:${nt}|chat:${chatId}`;
          await cache.set(cacheKey, fullText, ReactAgent.RESPONSE_CACHE_TTL);
        }

        if (cfg.autoMemoryStore && fullText) {
          learningEngine.autoExtractAndStore(input, fullText, this.mcpManager).catch(() => { });
        }

        if (cfg.autoMacroCreate && toolTrace.length > 0) {
          const inputStr = typeof input === 'string' ? input : '[audio input]';
          learningEngine.extractMacroFromSuccess(inputStr, toolTrace).catch((e: any) => {
            console.error('[React Agent] Macro extraction failed:', e);
          });
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

    // Check for recursion limits caused by massive loops
    if (error.name === 'GraphRecursionError' || error.message?.includes('Recursion limit')) {
      return "I thought very deeply about this, but I hit my multi-step processing limit. Could you simplify the request or ask me to focus on a smaller part?";
    }

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
