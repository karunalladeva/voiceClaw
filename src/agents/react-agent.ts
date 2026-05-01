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
import { agentEvents } from '../admin/agent-events';


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
  private static readonly MAX_CONTEXT_CHARS = 18000;
  private activeSkillExecutions = 0;
  private queuedSkillExecutions = 0;
  private totalQueuedSkillExecutions = 0;
  private totalSkillQueueTimeouts = 0;
  private skillQueue: Array<{
    priority: number;
    enqueuedAt: number;
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    timeoutHandle: ReturnType<typeof setTimeout>;
  }> = [];

  private getSkillConcurrencyConfig(): { maxParallelSkills: number; timeoutMs: number } {
    const cfg = configManager.getConfig().agent || ({} as any);
    const maxParallelSkills = Math.max(1, Number(cfg.maxParallelSkills ?? 2));
    const timeoutMs = Math.max(1000, Number(cfg.skillQueueTimeoutMs ?? 30000));
    return { maxParallelSkills, timeoutMs };
  }

  private mapSkillPriority(priority?: 'background' | 'normal' | 'interactive'): number {
    if (priority === 'interactive') return 2;
    if (priority === 'background') return 0;
    return 1;
  }

  private drainSkillQueue(): void {
    const { maxParallelSkills } = this.getSkillConcurrencyConfig();
    if (this.activeSkillExecutions >= maxParallelSkills || this.skillQueue.length === 0) return;
    this.skillQueue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.enqueuedAt - b.enqueuedAt;
    });
    const next = this.skillQueue.shift();
    if (!next) return;
    clearTimeout(next.timeoutHandle);
    if (next.signal?.aborted) {
      this.queuedSkillExecutions = Math.max(0, this.queuedSkillExecutions - 1);
      next.reject(new Error('Skill execution aborted while waiting for queue slot.'));
      this.drainSkillQueue();
      return;
    }
    this.queuedSkillExecutions = Math.max(0, this.queuedSkillExecutions - 1);
    this.activeSkillExecutions += 1;
    next.resolve(() => {
      this.activeSkillExecutions = Math.max(0, this.activeSkillExecutions - 1);
      this.drainSkillQueue();
    });
  }

  private async acquireSkillSlot(
    priority: 'background' | 'normal' | 'interactive' = 'normal',
    signal?: AbortSignal,
  ): Promise<() => void> {
    const { maxParallelSkills, timeoutMs } = this.getSkillConcurrencyConfig();
    if (this.activeSkillExecutions < maxParallelSkills && this.skillQueue.length === 0) {
      this.activeSkillExecutions += 1;
      return () => {
        this.activeSkillExecutions = Math.max(0, this.activeSkillExecutions - 1);
        this.drainSkillQueue();
      };
    }

    this.queuedSkillExecutions += 1;
    this.totalQueuedSkillExecutions += 1;

    return new Promise<() => void>((resolve, reject) => {
      const enqueuedAt = Date.now();
      const queuedItem = {
        priority: this.mapSkillPriority(priority),
        enqueuedAt,
        resolve,
        reject,
        signal,
        timeoutHandle: setTimeout(() => {
          const idx = this.skillQueue.indexOf(queuedItem);
          if (idx >= 0) this.skillQueue.splice(idx, 1);
          this.queuedSkillExecutions = Math.max(0, this.queuedSkillExecutions - 1);
          this.totalSkillQueueTimeouts += 1;
          reject(new Error(`Skill queue timeout after ${timeoutMs}ms.`));
        }, timeoutMs),
      };
      this.skillQueue.push(queuedItem);
      this.drainSkillQueue();
    });
  }

  getRuntimeMetrics() {
    return {
      activeSkillExecutions: this.activeSkillExecutions,
      queuedSkillExecutions: this.queuedSkillExecutions,
      totalQueuedSkillExecutions: this.totalQueuedSkillExecutions,
      totalSkillQueueTimeouts: this.totalSkillQueueTimeouts,
      queuedInteractive: this.skillQueue.filter((q) => q.priority === 2).length,
      queuedNormal: this.skillQueue.filter((q) => q.priority === 1).length,
      queuedBackground: this.skillQueue.filter((q) => q.priority === 0).length,
      ...this.getSkillConcurrencyConfig(),
    };
  }



  // ── Cache TTLs (matching OpenClaw) ────────────────────────────────────────
  private static readonly MEMORY_CACHE_TTL = 5 * 60 * 1000;   // 5 mins
  private static readonly RESPONSE_CACHE_TTL = 2 * 60 * 1000; // 2 mins



  private isTimeSensitiveQuery(query: string): boolean {
    const timeWords = /\b(today|current|currently|now|latest|live|right now|at the moment|updated|newest|recent)\b/i;
    const volatileTopics = /\b(price|rate|gold|silver|stock|crypto|weather|temperature|news|score|traffic|exchange|market)\b/i;
    return timeWords.test(query) && volatileTopics.test(query);
  }

  private buildTemporalMemoryGuard(): string {
    return `
<memory_temporal_guard>
Memories can be historical and may be outdated.
If the user asks for current/today/latest values (especially prices, rates, weather, news, scores, market data), NEVER treat memory as live truth.
Use a tool for fresh lookup, or clearly say live data is unavailable.
</memory_temporal_guard>`;
  }

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
5. TEMPORAL ACCURACY: Memories may be old. For time-sensitive requests (today/current/latest prices, rates, weather, news, scores), do not answer from memory alone. Fetch fresh data with tools, or state that live data is unavailable.
6. VOICE MINIMAL SUMMARY: When your natural-language answer is long (roughly more than a few minutes of speech), put the full detail first for the screen, then append exactly one block at the very end in this exact form (plain text inside, no markdown lists inside the block):
<spoken_summary>
Two to four short sentences with only the essentials for voice (example weather: place, condition, key numbers). No bullet points.
</spoken_summary>
Do not add this block for raw tool dumps, JSON-only results, or when the entire reply is already very short.
7. USER-FIRST EXECUTION: Prioritize completing what the user asks with concrete action and minimal deflection. If a request is illegal, harmful, or violates safety boundaries, clearly state that constraint in one short sentence, refuse only the disallowed part, and offer the closest safe/legal alternative that still helps the user's goal.
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
          query: z.string().describe('The specific natural language instruction for the skill'),
          priority: z.enum(['background', 'normal', 'interactive']).optional().describe('Queue priority for skill execution.'),
        }),
        func: async ({ skillId, query, priority }, runManager, config) => {
          const skill = this.skillRegistry.getSkill(skillId);
          if (!skill || !skill.enabled) return `Skill ${skillId} not found or disabled.`;

          const subAgentId = `skill-${skill.id}-${Date.now()}`;
          const parentAgentId = (config as any)?.agentId || 'main';
          const chatId = (config as any)?.chatId || 'default';

          console.log(`[Agent: Skill (${skill.name})] Executing nested sub-graph logic...`);
          
          agentEvents.emit('agent:spawned', {
            agentId: subAgentId,
            parentAgentId,
            chatId,
            skillId: skill.id,
            skillName: skill.name,
            input: query.substring(0, 100),
          });

          let finalOutput = '';
          let releaseSkillSlot: (() => void) | null = null;
          const signal = (config as any)?.signal as AbortSignal | undefined;

          try {
            const queuePriority =
              priority || (skill.id === 'screen-reader' ? 'interactive' : 'normal');
            releaseSkillSlot = await this.acquireSkillSlot(queuePriority, signal);
            agentEvents.emit('skill:started', {
              agentId: subAgentId,
              chatId,
              skillId: skill.id,
              skillName: skill.name,
            });

            for await (const skillEvent of this.agentFactory.runStream(skill, query)) {
              if (skillEvent.type === 'text_done' || skillEvent.type === 'error') {
                finalOutput = skillEvent.data;
              }
            }

            agentEvents.emit('skill:completed', {
              agentId: subAgentId,
              chatId,
              skillId: skill.id,
              skillName: skill.name,
              output: finalOutput.substring(0, 200),
            });
          } catch (e: any) {
            finalOutput = `Skill crashed: ${e.message}`;
            agentEvents.emit('agent:error', {
              agentId: subAgentId,
              chatId,
              error: e.message,
            });
          } finally {
            if (releaseSkillSlot) releaseSkillSlot();
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
    const isTimeSensitive = this.isTimeSensitiveQuery(query);

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
      const memoryBlock = cached ? `\n\n<memory>\n${cached}\n</memory>` : '';
      return base + memoryBlock + (isTimeSensitive ? this.buildTemporalMemoryGuard() : '');
    }

    try {
      const memories = await this.mcpManager.searchMemory(query);
      await cache.set(cacheKey, memories || '', ReactAgent.MEMORY_CACHE_TTL);
      if (memories) {
        console.log('[ReAct Agent] Injecting fresh memories into context.');
        return base + `\n\n<memory>\n${memories}\n</memory>` + (isTimeSensitive ? this.buildTemporalMemoryGuard() : '');
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

  private selectContextMessages(thread: BaseMessage[], input: string | any): BaseMessage[] {
    const inputSize = typeof input === 'string' ? input.length : 300;
    const budget = Math.max(6000, ReactAgent.MAX_CONTEXT_CHARS - inputSize);
    const selected: BaseMessage[] = [];
    let used = 0;

    const summaryMessages = thread.filter(
      (m) => m.getType() === 'system' && m.content.toString().startsWith('[Conversation Summary]:'),
    );
    for (const s of summaryMessages.slice(-1)) {
      selected.push(s);
      used += s.content.toString().length;
    }

    for (let i = thread.length - 1; i >= 0; i--) {
      const msg = thread[i];
      const isSummary = msg.getType() === 'system' && msg.content.toString().startsWith('[Conversation Summary]:');
      if (isSummary) continue;
      const content = msg.content?.toString?.() ?? '';
      if ((used + content.length) > budget) break;
      selected.unshift(msg);
      used += content.length;
    }

    return selected;
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
      const contextMessages = this.selectContextMessages(thread, input);
      const result = await this.graph.invoke({
        messages: [
          new SystemMessage(systemPrompt),
          ...contextMessages,
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
    const agentId = `${chatId}-${Date.now()}`;
    const startTime = Date.now();
    const inputStr = typeof input === 'string' ? input : '[audio/multimodal input]';
    
    agentEvents.emit('agent:started', {
      chatId,
      agentId,
      input: inputStr.substring(0, 200),
      modelId: this.activeModelId,
    });

    const rawKey = typeof input === 'string' ? input.trim().toLowerCase() : '[audio]';
    const numTurns = await historyManager.getHistoryLength(chatId);
    const cacheKey = `resp:${rawKey}|hist:${numTurns}|chat:${chatId}`;
    const cachedResponse = await cache.get(cacheKey);

    if (cachedResponse) {
      console.log(`[ReAct Agent] Cache hit for: "${rawKey}"`);
      agentEvents.emit('system:log', { chatId, agentId, level: 'info', message: `Cache hit for: "${rawKey.substring(0, 50)}"` });
      yield { type: 'thinking', data: 'Retrieving cached response…' };
      const tokens = cachedResponse.split(' ');
      for (const token of tokens) {
        yield { type: 'token', data: token + ' ' };
      }
      agentEvents.emit('agent:completed', { chatId, agentId, duration: Date.now() - startTime, output: cachedResponse.substring(0, 200) });
      yield { type: 'text_done', data: cachedResponse };
      return;
    }


    const modelId = this.activeModelId;
    console.log(`[Agent: ReAct] [Model: ${modelId}] Streaming response for input…`);
    agentEvents.emit('model:loading', { chatId, agentId, modelId });

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
        const contextMessages = this.selectContextMessages(threadMsgs, input);
        const inputMessages = {
          messages: [
            new SystemMessage(systemPrompt + retryPrefix),
            ...contextMessages,
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

        agentEvents.emit('model:inference_start', { chatId, agentId, modelId: this.activeModelId });

        for await (const event of stream) {
          if (signal?.aborted) {
            console.log('[ReAct Agent] Stream aborted by client.');
            agentEvents.emit('agent:error', { chatId, agentId, error: 'Aborted by client' });
            return;
          }

          if (event.event === 'on_chat_model_stream') {
            const chunk = event.data?.chunk;

            if (chunk?.additional_kwargs?.reasoning_content) {
              const thought = chunk.additional_kwargs.reasoning_content.toString();
              if (thought) {
                // agentEvents.emit('agent:thinking', { chatId, agentId, message: thought.substring(0, 100) });
                yield { type: 'thinking', data: thought };
              }
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
                  // agentEvents.emit('agent:thinking', { chatId, agentId, message: thinkingBuffer.substring(0, 100) });
                  yield { type: 'thinking', data: thinkingBuffer.trim() };
                  thinkingBuffer = '';
                  if (parts[1]) {
                    fullText += parts[1];
                    // agentEvents.emit('model:token', { chatId, agentId, token: parts[1] });
                    yield { type: 'token', data: parts[1] };
                  }
                } else {
                  thinkingBuffer += token;
                  if (thinkingBuffer.length % 20 === 0) {
                    yield { type: 'thinking', data: thinkingBuffer.substring(Math.max(0, thinkingBuffer.length - 80)).trim() + '...' };
                  }
                }
              } else {
                if (token) {
                  fullText += token;
                  // agentEvents.emit('model:token', { chatId, agentId, token: token.substring(0, 20) });
                  yield { type: 'token', data: token };
                }
              }
            }
          } else if (event.event === 'on_tool_start') {
            const modelId = this.activeModelId;
            const toolName = event.name || 'unknown';
            const toolStartTime = Date.now();
            console.log(`[Agent: ReAct] [Model: ${modelId}] Tool call: ${toolName}`);

            agentEvents.emit('tool:started', {
              chatId,
              agentId,
              toolName,
              toolArgs: event.data?.input,
            });

            if (event.name === 'route_to_skill') {
              const toolInput = event.data?.input;
              const skill = this.skillRegistry.getSkill(toolInput?.skillId);
              if (skill?.enabled) {
                console.log(`[Agent: Skill (${skill.name})] Routing to specialized skill natively...`);
                agentEvents.emit('skill:routing', { chatId, agentId, skillId: skill.id, skillName: skill.name });
                yield { type: 'thinking', data: `Delegating to Sub-Agent: ${skill.name}…` };
              }
            } else {
              toolTrace.push({ tool: toolName, args: event.data?.input });
            }

            if (fullText) fullText = '';
            yield { type: 'tool_call', data: toolName };
            toolWasCalled = true;
          } else if (event.event === 'on_tool_end') {
            const toolName = event.name || 'unknown';
            agentEvents.emit('tool:completed', {
              chatId,
              agentId,
              toolName,
              toolResult: (event.data?.output || '').toString().substring(0, 200),
            });
          }

        }

        // NO LONGER NEED parseSkillRoute HERE AS WE INTERCEPT IT ABOVE

        // Check if we should retry
        const failureAssessment = learningEngine.assessFailure(fullText);
        if (attempt < maxRetries && failureAssessment.shouldRetry) {
          const modelId = this.activeModelId;
          console.log(`[Agent: ReAct] [Model: ${modelId}] Response indicates failure (${failureAssessment.failureType}). Attempting to recover… (attempt ${attempt + 1}/${maxRetries})`);
          attemptHistory.push({ attempt: attempt + 1, response: fullText });


          if (cfg.autoSkillCreate) {
            yield { type: 'thinking', data: `Learning from ${failureAssessment.failureType} and creating a skill…` };
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
        
        agentEvents.emit('model:inference_end', { chatId, agentId, modelId: this.activeModelId });
        
        if (fullText) {
          await this.appendToHistory(chatId, input, fullText);
          const rawKey = typeof input === 'string' ? input.trim().toLowerCase() : '[audio]';
          const nt = await historyManager.getHistoryLength(chatId);
          const cacheKey = `resp:${rawKey}|hist:${nt}|chat:${chatId}`;
          await cache.set(cacheKey, fullText, ReactAgent.RESPONSE_CACHE_TTL);
        }

        if (cfg.autoMemoryStore && fullText) {
          learningEngine.autoExtractAndStore(input, fullText, this.mcpManager).catch(() => { });
          agentEvents.emit('memory:stored', { chatId, agentId, message: 'Auto-extracted memory from conversation' });
        }

        if (cfg.autoMacroCreate && toolTrace.length > 0) {
          const inputStr = typeof input === 'string' ? input : '[audio input]';
          learningEngine.extractMacroFromSuccess(inputStr, toolTrace).catch((e: any) => {
            console.error('[React Agent] Macro extraction failed:', e);
          });
        }

        agentEvents.emit('agent:completed', {
          chatId,
          agentId,
          duration: Date.now() - startTime,
          output: fullText.substring(0, 200),
          toolCallCount: toolTrace.length,
        });

        yield { type: 'text_done', data: fullText };
        return;
      } catch (error: any) {
        agentEvents.emit('agent:error', {
          chatId,
          agentId,
          error: error.message || 'Unknown error',
          duration: Date.now() - startTime,
        });
        yield { type: 'error', data: this.handleError(error) };
        return;
      }
    }

    // All retries exhausted
    agentEvents.emit('agent:completed', {
      chatId,
      agentId,
      duration: Date.now() - startTime,
      output: 'Retries exhausted',
    });
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
