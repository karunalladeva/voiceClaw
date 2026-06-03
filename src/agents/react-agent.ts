import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, AIMessage, SystemMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

// @ts-ignore
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { MCPClientManager } from './mcp-client';
import { AgentFactory, extractToolOutputFromEvent, SKILL_RUN_INCOMPLETE_MARKER } from './agent-factory';
import {
  capOrchestratorHandoff,
  ORCHESTRATOR_HANDOFF_MAX_CHARS,
  parseIncompleteSkillId,
} from './skill-handoff';
import { invokeWithToolXmlFallback } from '../utils/ollama-tool-call';
import {
  buildBlockedSkillRouteResult,
  registerBlockedSkill,
  resolveBlockedSkillIdsForRun,
} from './skill-route-guard';
import { SkillRegistry } from '../skills/registry';
import { configManager } from '../config/index';
import { modelRegistry } from '../models/model-registry';
import { modelRouter } from '../models/model-router';
import { learningEngine } from './learning-engine';
import { filterMemoriesForContext, shouldSkipAutoMemoryExtraction } from './memory-policy';
import { cache } from '../utils/cache';
import { agentEvents } from '../admin/agent-events';


import { historyManager } from './agent-history';
import {
  extractUserQueryText,
  isCasualMessage,
  isSynthesisOverProvidedData,
  requiresLiveLookup,
  getLiveLookupDomain,
  hasVolatileNumericToolOutput,
  toolTraceHasAdequateLiveData,
  failsCricketSanityCheck,
  type LiveLookupDomain,
} from './prompt-context';
import {
  capUserInputForInference,
  debugLogPromptMessages,
  logPromptSizes,
  marketSymbolStatsFromHumanInput,
  sumMessagesChars,
} from '../utils/prompt-budget';
import type { SkillRoutingMode } from '../skills/registry';
import type { AgentRunOptions } from './agent-run-options';
import { DEFAULT_ORG_MODEL_ID } from '../orchestration/agent-normalizer';
import { getAgentRunContext, getAgentRunStorage, toTaskArtifactScope, type AgentRunContext } from './agent-run-context';
import { persistTaskResponse } from '../orchestration/task-response-store';
import { isInferenceInterruptError } from '../utils/inference-interrupt';
import { truncateToolOutput } from '../utils/tool-output-truncate';

export type { AgentRunOptions } from './agent-run-options';

export interface StreamEvent {
  type: 'transcription' | 'thinking' | 'tool_call' | 'token' | 'text_done' | 'audio_start' | 'audio' | 'error' | 'done';
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
    return requiresLiveLookup(query);
  }

  private buildLiveDataRequiredBlock(domain: LiveLookupDomain): string {
    const routing =
      domain === 'markets'
        ? 'Prefer trading or Yahoo finance market tools for symbols and quotes; use web_search then web_fetch only if no market tool applies.'
        : 'You MUST call web_search, then web_fetch on a relevant result URL, before stating any live numbers.';
    return `
<live_data_required>
This question requires fresh live data. ${routing}
list_memories and search_memory are NOT live data sources — never use them as the only source for current scores, prices, weather, or news.
Do not copy numbers from prior assistant messages in the chat — re-fetch every time.
If tools fail or pages lack the fact, say live data is unavailable. Never invent or guess scores, prices, or stats.
</live_data_required>`;
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
4. MEMORY INSTRUCTIONS: Use store_memory ONLY for durable user facts (name, location, timezone, long-term preferences). Do NOT store chat transcripts, stock reports, pipeline setup, or one-time tasks. If a <memory> block is present below, use it; otherwise do NOT call list_memories or search_memory for greetings, small talk, or messages under 4 words unless the user asks to recall or save something.
5. TEMPORAL ACCURACY: Memories may be old. For any live or time-sensitive request (today/current/latest prices, rates, weather, news, sports scores, match status), you MUST fetch fresh data with the correct tools before stating numbers. Never answer from memory, chat history, or search snippets alone. For sports and news use web_search then web_fetch; for markets use trading tools first. If live data is unavailable, say so — never invent scores or prices.
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
          const master = modelRegistry.getMaster();
          this.activeModelId = master?.id || 'unknown';
          if (master) {
            void import('../models/model-load-coordinator').then(({ modelLoadCoordinator }) => {
              modelLoadCoordinator.noteLocalModelInUse(master);
            });
          }
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
          const master = modelRegistry.getMaster();
          if (master) {
            void import('../models/model-load-coordinator').then(({ modelLoadCoordinator }) => {
              modelLoadCoordinator.noteLocalModelInUse(master);
            });
          }
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
      if (masterConfig) {
        const { modelLoadCoordinator } = await import('../models/model-load-coordinator');
        modelLoadCoordinator.noteLocalModelInUse(masterConfig);
      }


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
      const { modelLoadCoordinator } = await import('../models/model-load-coordinator');
      await modelLoadCoordinator.prepareForLocalModelLoad();
      console.log(`[Agent: ReAct] [Model: ${modelId}] Warming up model (cold-start pre-load)…`);
      await (this.llm as any).invoke([new HumanMessage({ content: 'hi' })]);
      console.log(`[Agent: ReAct] [Model: ${modelId}] Model warm-up complete. (Ollama keep_alive=-1: model stays loaded indefinitely)`);
    } catch {
      const modelId = this.activeModelId;
      console.warn(`[Agent: ReAct] [Model: ${modelId}] Model warm-up failed (model may load on first use).`);
    }

  }


  private getSystemTools(skillAllowlist?: string[]): DynamicStructuredTool[] {
    let enabled = this.skillRegistry.getEnabledSkills();
    if (skillAllowlist && skillAllowlist.length > 0) {
      const allow = new Set(skillAllowlist);
      enabled = enabled.filter(s => allow.has(s.id));
    }
    const coreSkillIds = enabled
      .filter((s) => !s.id.startsWith('trading-'))
      .map((s) => s.id)
      .join(', ');

    return [
      new DynamicStructuredTool({
        name: 'route_to_skill',
        description:
          `CRITICAL: Call directly — do NOT use shell_exec. Routes to a sub-agent. Core skillIds: ${coreSkillIds}. Trading skills use prefix trading-* (see system <skills> catalog). Default market analyst: voiceclaw-financial-analyst.`,
        schema: z.object({
          skillId: z.string().describe('Exact skill id from the <skills> section (core id or trading-* id).'),
          query: z.string().describe('The specific natural language instruction for the skill'),
          priority: z.enum(['background', 'normal', 'interactive']).optional().describe('Queue priority for skill execution.'),
        }),
        func: async ({ skillId, query, priority }, runManager, config) => {
          if (skillAllowlist && skillAllowlist.length > 0 && !skillAllowlist.includes(skillId)) {
            return `Skill ${skillId} is not allowed for this agent run.`;
          }
          const skill = this.skillRegistry.getSkill(skillId);
          if (!skill || !skill.enabled) return `Skill ${skillId} not found or disabled.`;

          const blocked = await resolveBlockedSkillIdsForRun();
          if (blocked.has(skillId)) {
            const taskId = getAgentRunContext()?.orgTaskId ?? 'n/a';
            console.warn(
              `[route_to_skill] Hard block: "${skillId}" already incomplete on task ${taskId}`,
            );
            return buildBlockedSkillRouteResult(skill.name, skillId);
          }

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

            let skillFailed = false;
            for await (const skillEvent of this.agentFactory.runStream(skill, query)) {
              if (skillEvent.type === 'text_done') {
                finalOutput = skillEvent.data;
                if (finalOutput.includes(SKILL_RUN_INCOMPLETE_MARKER)) {
                  skillFailed = true;
                }
              } else if (skillEvent.type === 'error') {
                skillFailed = true;
                if (!finalOutput.trim()) finalOutput = skillEvent.data;
              }
            }

            if (
              skillFailed ||
              finalOutput.includes(SKILL_RUN_INCOMPLETE_MARKER)
            ) {
              registerBlockedSkill(parseIncompleteSkillId(finalOutput) ?? skill.id);
            }

            agentEvents.emit('skill:completed', {
              agentId: subAgentId,
              chatId,
              skillId: skill.id,
              skillName: skill.name,
              output: finalOutput.substring(0, 200),
            });
            const runCtx = getAgentRunContext();
            if (runCtx && finalOutput.trim()) {
              persistTaskResponse({
                task: toTaskArtifactScope(runCtx),
                responderId: skill.id,
                responderType: 'skill',
                content: finalOutput,
                agentId: runCtx.orgAgentId,
                success: !skillFailed,
              });
            }
          } catch (e: any) {
            finalOutput = `Skill crashed: ${e.message}`;
            const runCtx = getAgentRunContext();
            if (runCtx) {
              persistTaskResponse({
                task: toTaskArtifactScope(runCtx),
                responderId: skill.id,
                responderType: 'skill',
                content: finalOutput,
                agentId: runCtx.orgAgentId,
                success: false,
              });
            }
            agentEvents.emit('agent:error', {
              agentId: subAgentId,
              chatId,
              error: e.message,
            });
          } finally {
            if (releaseSkillSlot) releaseSkillSlot();
          }

          const handoffBody = capOrchestratorHandoff(
            finalOutput || 'No text output produced.',
          );
          return `[Sub-Agent Result from ${skill.name}]:\n${handoffBody}`;
        }
      })
    ];
  }


  // ── Graph compilation ──────────────────────────────────────────────────────

  private compileGraph(
    tools: DynamicStructuredTool[],
    llmOverride?: BaseChatModel,
    skillAllowlist?: string[],
  ): any {
    const llm = llmOverride ?? this.llm;
    if (!llm) {
      console.warn('[ReAct Agent] compileGraph called before LLM is ready — skipping.');
      return null;
    }

    const sysTools = this.getSystemTools(skillAllowlist);
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

      const response = await invokeWithToolXmlFallback(
        llmWithTools,
        llm,
        optimizedMessages,
      );
      return { messages: [response] };
    };

    // ── Tool Node with Summarization (Noise Reduction) ────────────────────────
    // We pass allTools here so ToolNode knows how to execute route_to_skill natively!
    const toolNodeWithTruncation = async (state: typeof MessagesAnnotation.State) => {
      const output = await new ToolNode(allTools).invoke(state);
      // Prune massive tool results for the current turn to avoid single-turn overflow
      for (const msg of output.messages) {
        if (!msg.content || msg.content.length <= 12000) continue;
        const contentStr = msg.content.toString();
        if (contentStr.includes('[Sub-Agent Result from')) {
          if (contentStr.length > ORCHESTRATOR_HANDOFF_MAX_CHARS) {
            msg.content = capOrchestratorHandoff(contentStr);
          }
          continue;
        }
        if (msg instanceof ToolMessage && msg.name === 'web_fetch') {
          console.warn(`[Agent: ReAct] Truncating web_fetch markdown (no LLM summarize)`);
          msg.content = truncateToolOutput(
            contentStr,
            12000,
          ).replace(
            '[TRUNCATED for context window]',
            '[TRUNCATED — use web_fetch with part=1,2,… or focus= subtopic. Do not invent missing facts.]',
          );
          continue;
        }
        if (hasVolatileNumericToolOutput(contentStr)) {
          console.warn(`[Agent: ReAct] Preserving volatile numeric tool output via truncation (no LLM summarize)`);
          msg.content =
            contentStr.substring(0, 12000) +
            '\n\n...[OUTPUT TRUNCATED — use web_fetch with part=1+ or focus to read more. Do not invent missing numbers.]...';
          continue;
        }
        const modelId = this.activeModelId;
        console.warn(`[Agent: ReAct] [Model: ${modelId}] Summarizing massive tool output: ${contentStr.substring(0, 50)}…`);
        try {
          const fastModel = await modelRouter.getModel('summarize');
          const summary = await Promise.race([
            (fastModel as any).invoke([
              new SystemMessage("You are an expert at summarizing massive tool/command outputs. Summarize the following output accurately to retain all crucial details, keeping it under 2000 characters. Make the summary fast and concise."),
              new HumanMessage({ content: contentStr.substring(0, 40000) }),
            ]),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Summarization Timeout')), 60000)),
          ]);
          msg.content = `[Tool Output Summarized for Context Efficiency]:\n${(summary as any).content.toString()}`;
        } catch (e) {
          console.warn(`[Agent: ReAct] Summarizer failed or timed out, falling back to truncation:`, e);
          msg.content = contentStr.substring(0, 12000) + '\n\n...[OUTPUT TRUNCATED FOR CONTEXT EFFICIENCY]...';
        }
      }

      return output;
    };

    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      const lastMessage = state.messages[state.messages.length - 1] as any;
      if (
        lastMessage instanceof ToolMessage &&
        lastMessage.name === 'route_to_skill' &&
        String(lastMessage.content ?? '').includes('[Sub-Agent Result from') &&
        getAgentRunContext()?.orgTaskId
      ) {
        return '__end__';
      }
      if (lastMessage.tool_calls?.length) return 'tools';
      return '__end__';
    };

    const workflow = new StateGraph(MessagesAnnotation)
      .addNode('agent', callModel)
      .addNode('tools', toolNodeWithTruncation)
      .addEdge('__start__', 'agent')
      .addConditionalEdges('agent', shouldContinue)
      .addEdge('tools', 'agent');



    const compiled = workflow.compile();
    if (!llmOverride) {
      this.graph = compiled;
    }
    return compiled;
  }

  // ── System prompt / memory ─────────────────────────────────────────────────

  private getSystemPrompt(userQuery?: string, skillAllowlist?: string[], routingMode?: SkillRoutingMode): string {
    const mode: SkillRoutingMode =
      routingMode ??
      (isSynthesisOverProvidedData(userQuery || '') ? 'synthesis' : 'auto');
    return (
      this.getBaseSystemPrompt() +
      this.skillRegistry.buildRoutingPrompt(userQuery, skillAllowlist, mode) +
      this.skillRegistry.getLearnedSkillsContext()
    );
  }


  private isMemoryEnabled(): boolean {
    return configManager.getConfig().memory?.enabled ?? true;
  }

  private async buildSystemPromptWithMemory(
    input: string | any,
    skillAllowlist?: string[],
  ): Promise<string> {
    const queryText = extractUserQueryText(input);
    const query = queryText.toLowerCase() || 'general user context';
    const synthesis = isSynthesisOverProvidedData(queryText);
    const base = this.getSystemPrompt(
      queryText,
      skillAllowlist,
      synthesis ? 'synthesis' : 'auto',
    );
    const needsLive = requiresLiveLookup(queryText) && !synthesis;
    if (needsLive) {
      const domain = getLiveLookupDomain(queryText);
      return base + this.buildLiveDataRequiredBlock(domain) + this.buildTemporalMemoryGuard();
    }
    if (!this.isMemoryEnabled()) return base;
    const isTimeSensitive = this.isTimeSensitiveQuery(query);
    if (isCasualMessage(queryText)) {
      return base;
    }
    const cacheKey = `mem:${query}`;
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
    } catch {
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

  async clearAllHistory(): Promise<number> {
    const deleted = await historyManager.clearAllChats();
    await cache.clear();
    console.log(`[ReAct Agent] Cleared ${deleted} conversation file(s) and response caches.`);
    return deleted;
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
    historyManager.syncMessageMeta(chatId);

    const maxMessages = ReactAgent.MAX_HISTORY_TURNS * 2;
    if (thread.length > maxMessages) {
      const overflowCount = thread.length - maxMessages;
      const indicesToSummarize: number[] = [];
      const batchLines: string[] = [];
      for (let i = 0; i < thread.length && indicesToSummarize.length < overflowCount; i++) {
        if (historyManager.isMessageSummarized(chatId, i)) continue;
        const msg = thread[i];
        if (msg.getType() === 'system') continue;
        indicesToSummarize.push(i);
        batchLines.push(`${msg.getType().toUpperCase()}: ${msg.content}`);
      }
      if (indicesToSummarize.length > 0) {
        historyManager.markIndicesSummarized(chatId, indicesToSummarize);
        const previousSummaries = historyManager.getCombinedSummariesText(chatId);
        const batchText = batchLines.join('\n');
        modelRouter.getModel('summarize').then((fastModel) => {
          console.log(`[ReAct Agent] Background summarization for ${indicesToSummarize.length} message(s) (kept in JSON, isSummarized=true)...`);
          return fastModel.invoke([
            new SystemMessage(
              'Summarize conversation history briefly. Merge with any previous summaries so critical long-term context is retained. Be concise.',
            ),
            new HumanMessage({
              content: previousSummaries
                ? `Previous summaries:\n${previousSummaries}\n\nNew messages to fold in:\n${batchText}`
                : `Messages to summarize:\n${batchText}`,
            }),
          ]);
        }).then((res) => {
          const summaryBody = res.content.toString().trim();
          historyManager.appendSummary(chatId, summaryBody, indicesToSummarize.length);
          historyManager.saveChat(chatId);
          console.log(`[ReAct Agent] History summarization stored (summaries key, ${indicesToSummarize.length} messages marked).`);
        }).catch((err) => console.warn('[History Summarizer] Failed to summarize context:', err));
      }
    }

    await historyManager.saveChat(chatId, typeof humanInput === 'string' ? humanInput : undefined);
  }

  private async selectContextMessages(
    chatId: string,
    reservedChars: number,
  ): Promise<BaseMessage[]> {
    const maxTotal = configManager.getConfig().agent.maxPromptChars ?? 30_000;
    const budget = Math.max(2000, maxTotal - reservedChars);
    return historyManager.buildLlmContextMessages(chatId, budget);
  }

  /** Apply total prompt budget: shrink human input if system + history + human exceed cap. */
  private applyPromptBudget(
    systemPrompt: string,
    input: string | any,
    contextMessages: BaseMessage[],
  ): { systemPrompt: string; input: string | any; contextMessages: BaseMessage[] } {
    const maxTotal = configManager.getConfig().agent.maxPromptChars ?? 30_000;
    let sys = systemPrompt;
    let human = input;
    let ctx = contextMessages;

    const humanLen = typeof human === 'string' ? human.length : 300;
    let historyLen = sumMessagesChars(ctx);
    let total = sys.length + humanLen + historyLen;

    if (total <= maxTotal) {
      return { systemPrompt: sys, input: human, contextMessages: ctx };
    }

    if (isSynthesisOverProvidedData(extractUserQueryText(human)) && sys.length > 8000) {
      const queryText = extractUserQueryText(human);
      sys =
        this.getSystemPrompt(queryText, undefined, 'synthesis') +
        this.skillRegistry.getLearnedSkillsContext();
      total = sys.length + humanLen + historyLen;
    }

    if (total > maxTotal && historyLen > 2000) {
      const trimHistory = Math.max(2000, historyLen - (total - maxTotal));
      ctx = ctx.slice(-Math.max(2, Math.floor((trimHistory / historyLen) * ctx.length)));
      historyLen = sumMessagesChars(ctx);
      total = sys.length + humanLen + historyLen;
    }

    if (total > maxTotal && typeof human === 'string') {
      const queryText = extractUserQueryText(human);
      const room = Math.max(2000, maxTotal - sys.length - historyLen);
      human = capUserInputForInference(human, room, queryText);
      total = sys.length + human.length + historyLen;
    }

    return { systemPrompt: sys, input: human, contextMessages: ctx };
  }



  // ── Public API ─────────────────────────────────────────────────────────────

  /** Expose MCP manager for server-side memory operations. */
  getMcpManager(): MCPClientManager {
    return this.mcpManager;
  }

  /** Rebuild MCP + native tools after optional MCP servers connect at startup. */
  async reloadToolkit(): Promise<void> {
    const mcpTools = await this.mcpManager.loadTools();
    const { loadNativeTools } = await import('../loaders/tool-loader');
    const enableInternet = configManager.getConfig().agent?.enableInternet ?? true;
    const nativeTools = await loadNativeTools(enableInternet);
    const tools = [...mcpTools, ...nativeTools];
    this.lastTools = tools;
    if (this.llm) {
      this.compileGraph(tools);
    }
    console.log(`[ReAct Agent] Toolkit refreshed (${tools.length} tools).`);
  }

  getSkillRegistry(): SkillRegistry {
    return this.skillRegistry;
  }

  async reloadCreatorWorkspaceSkills(): Promise<number> {
    const count = await this.skillRegistry.reloadCreatorWorkspaceSkills();
    if (this.llm && this.lastTools.length > 0) {
      this.compileGraph(this.lastTools);
    }
    console.log(`[ReAct Agent] Reloaded ${count} creator workspace skill(s).`);
    return count;
  }



  // ── Non-streaming process ──────────────────────────────────────────────────

  async process(input: string | any, chatId: string = 'default'): Promise<string> {
    const modelId = this.activeModelId;
    console.log(`[Agent: ReAct] [Model: ${modelId}] Thinking about input…`);


    try {
      let systemPrompt = await this.buildSystemPromptWithMemory(input);
      await historyManager.loadChat(chatId);
      const inputLen = typeof input === 'string' ? input.length : 300;
      let contextMessages = await this.selectContextMessages(chatId, systemPrompt.length + inputLen);
      const budgeted = this.applyPromptBudget(systemPrompt, input, contextMessages);
      systemPrompt = budgeted.systemPrompt;
      const cappedInput = budgeted.input;
      contextMessages = budgeted.contextMessages;
      const humanChars = typeof cappedInput === 'string' ? cappedInput.length : inputLen;
      const symStats =
        typeof cappedInput === 'string'
          ? marketSymbolStatsFromHumanInput(cappedInput)
          : { inHuman: 0, requested: 0 };
      logPromptSizes({
        systemChars: systemPrompt.length,
        humanChars,
        historyChars: sumMessagesChars(contextMessages),
        symbolsInHuman: symStats.inHuman || undefined,
        symbolsRequested: symStats.requested || undefined,
      });
      const result = await this.graph.invoke({
        messages: [
          new SystemMessage(systemPrompt),
          ...contextMessages,
          new HumanMessage({ content: cappedInput }),
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

  async *processStream(
    input: string | any,
    chatId: string = 'default',
    signal?: AbortSignal,
    options?: AgentRunOptions,
  ): AsyncGenerator<StreamEvent> {
    if (options) {
      yield* this.processOrchestrationStream(input, chatId, signal, options);
      return;
    }
    const agentId = `${chatId}-${Date.now()}`;
    const startTime = Date.now();
    const inputStr = typeof input === 'string' ? input : '[audio/multimodal input]';
    
    agentEvents.emit('agent:started', {
      chatId,
      agentId,
      input: inputStr.substring(0, 200),
      modelId: this.activeModelId,
    });

    const queryText = extractUserQueryText(input);
    const synthesisInput = isSynthesisOverProvidedData(queryText);
    const needsLive = requiresLiveLookup(queryText) && !synthesisInput;
    const liveDomain = getLiveLookupDomain(queryText);

    const rawKey = typeof input === 'string' ? input.trim().toLowerCase() : '[audio]';
    const numTurns = await historyManager.getHistoryLength(chatId);
    const cacheKey = `resp:${rawKey}|hist:${numTurns}|chat:${chatId}`;
    const cachedResponse = needsLive ? null : await cache.get(cacheKey);

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
    let pendingLiveRetryPrefix = '';
    let liveToolRetryDone = false;
    let synthesisRetryDone = false;
    let sanityRetryDone = false;

    const liveExtraSlots = needsLive ? 2 : 0;
    for (let attempt = 0; attempt <= maxRetries + liveExtraSlots; attempt++) {
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
        const retryPrefix =
          (attempt > 0
            ? `\n\n[SELF-IMPROVEMENT] Previous attempt failed. Approach this differently. Attempt ${attempt + 1}.`
            : '') + pendingLiveRetryPrefix;
        pendingLiveRetryPrefix = '';

        await historyManager.loadChat(chatId);
        const humanLenEst =
          typeof processedInput === 'string' ? processedInput.length : 300;
        let contextMessages = await this.selectContextMessages(
          chatId,
          systemPrompt.length + retryPrefix.length + humanLenEst,
        );
        const budgeted = this.applyPromptBudget(
          systemPrompt + retryPrefix,
          processedInput,
          contextMessages,
        );
        let sysForRun = budgeted.systemPrompt;
        processedInput = budgeted.input;
        contextMessages = budgeted.contextMessages;

        const humanChars =
          typeof processedInput === 'string' ? processedInput.length : humanLenEst;
        const historyChars = sumMessagesChars(contextMessages);
        const symStats =
          typeof processedInput === 'string'
            ? marketSymbolStatsFromHumanInput(processedInput)
            : { inHuman: 0, requested: 0 };
        logPromptSizes({
          systemChars: sysForRun.length,
          humanChars,
          historyChars,
          symbolsInHuman: symStats.inHuman || undefined,
          symbolsRequested: symStats.requested || undefined,
        });

        const inputMessages = {
          messages: [
            new SystemMessage(sysForRun),
            ...contextMessages,
            new HumanMessage({ content: processedInput }),
          ],
        };

        let fullText = '';
        let inThinkingBlock = false;
        let thinkingBuffer = '';
        const toolTrace: Array<{ tool: string; args: any }> = [];

        debugLogPromptMessages('Input messages', inputMessages.messages);
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

            toolTrace.push({ tool: toolName, args: event.data?.input });
            if (event.name === 'route_to_skill') {
              const toolInput = event.data?.input;
              const skill = this.skillRegistry.getSkill(toolInput?.skillId);
              if (skill?.enabled) {
                console.log(`[Agent: Skill (${skill.name})] Routing to specialized skill natively...`);
                agentEvents.emit('skill:routing', { chatId, agentId, skillId: skill.id, skillName: skill.name });
                yield { type: 'thinking', data: `Delegating to Sub-Agent: ${skill.name}…` };
              }
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

        if (needsLive) {
          const adequate = toolTraceHasAdequateLiveData(toolTrace, liveDomain, queryText);
          const toolsListed = toolTrace.map((t) => t.tool).join(',') || 'none';
          console.log(
            `[ReAct Agent] live_lookup domain=${liveDomain} tools=[${toolsListed}] adequate=${adequate} cache_skipped=${needsLive}`,
          );
          agentEvents.emit('system:log', {
            chatId,
            agentId,
            level: adequate ? 'info' : 'warn',
            message: `live_lookup domain=${liveDomain} tools=[${toolsListed}] adequate=${adequate}`,
          });
          if (!adequate && !liveToolRetryDone) {
            liveToolRetryDone = true;
            const { extractStockSymbols } = await import('../utils/stock-tickers');
            const symbols = extractStockSymbols(queryText);
            const symHint =
              symbols.length > 1
                ? ` For each requested symbol call yahoo_ohlcv and yahoo_news (need at least ${Math.min(symbols.length, 3)} symbols with data): ${symbols.slice(0, 12).join(', ')}.`
                : '';
            pendingLiveRetryPrefix =
              `\n\n[LIVE DATA REQUIRED] Use yahoo_ohlcv and yahoo_news for stocks (or web_search then web_fetch if no market tools). list_memories/search_memory are NOT live sources. Do not guess numbers.${symHint}`;
            yield { type: 'thinking', data: 'Fetching fresh live data…' };
            continue;
          }
          if (
            !fullText.trim() &&
            toolWasCalled &&
            adequate &&
            !synthesisRetryDone
          ) {
            synthesisRetryDone = true;
            pendingLiveRetryPrefix =
              '\n\n[TOOLS COMPLETE] Live data is in the tool messages above. Write the full analysis now in plain text for every requested symbol. Do not call tools again unless a symbol has no OHLCV/news data.';
            yield { type: 'thinking', data: 'Writing analysis from live tool data…' };
            continue;
          }
          if (
            liveDomain === 'sports' &&
            failsCricketSanityCheck(fullText) &&
            !sanityRetryDone
          ) {
            sanityRetryDone = true;
            pendingLiveRetryPrefix =
              '\n\n[LIVE DATA SANITY] Prior answer had impossible cricket numbers (e.g. overs > 20 in T20). Re-fetch with web_fetch and only state facts from the page.';
            yield { type: 'thinking', data: 'Re-checking live score data…' };
            continue;
          }
        }

        const failureAssessment = learningEngine.assessFailure(fullText);
        const skipEmptyFailureRetry =
          !fullText.trim() &&
          toolWasCalled &&
          needsLive &&
          toolTraceHasAdequateLiveData(toolTrace, liveDomain, queryText);
        if (attempt < maxRetries && failureAssessment.shouldRetry && !skipEmptyFailureRetry) {
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

        console.log(`[ReAct Agent] Stream complete: "${fullText.substring(0, 80)}…"`);
        agentEvents.emit('model:inference_end', { chatId, agentId, modelId: this.activeModelId });
        agentEvents.emit('agent:completed', {
          chatId,
          agentId,
          duration: Date.now() - startTime,
          output: fullText.substring(0, 200),
          toolCallCount: toolTrace.length,
        });
        yield { type: 'text_done', data: fullText };
        if (fullText) {
          const rawKey = typeof input === 'string' ? input.trim().toLowerCase() : '[audio]';
          void (async () => {
            await this.appendToHistory(chatId, input, fullText);
            const nt = await historyManager.getHistoryLength(chatId);
            if (!needsLive) {
              const cacheKey = `resp:${rawKey}|hist:${nt}|chat:${chatId}`;
              await cache.set(cacheKey, fullText, ReactAgent.RESPONSE_CACHE_TTL);
            }
            if (cfg.autoMemoryStore) {
              const inputStr = typeof input === 'string' ? input : '[audio/multimodal input]';
              if (!shouldSkipAutoMemoryExtraction(chatId, inputStr, fullText)) {
                learningEngine.autoExtractAndStore(inputStr, fullText, this.mcpManager, chatId).catch(() => { });
                agentEvents.emit('memory:stored', { chatId, agentId, message: 'Auto-extracted memory from conversation' });
              }
            }
            if (cfg.autoMacroCreate && toolTrace.length > 0) {
              const inputStr = typeof input === 'string' ? input : '[audio input]';
              learningEngine.extractMacroFromSuccess(inputStr, toolTrace).catch((e: any) => {
                console.error('[React Agent] Macro extraction failed:', e);
              });
            }
          })().catch((err) => console.warn('[ReAct Agent] Post-reply housekeeping failed:', err));
        }
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

  private async resolveRunModel(
    modelId: string,
  ): Promise<{ llm: BaseChatModel; resolvedModelId: string }> {
    const id = modelId || DEFAULT_ORG_MODEL_ID;
    if (id === DEFAULT_ORG_MODEL_ID) {
      const master = modelRegistry.getMaster();
      const llm = await modelRouter.getMasterModel();
      return { llm, resolvedModelId: master?.id ?? DEFAULT_ORG_MODEL_ID };
    }
    const llm = await modelRouter.getById(id);
    if (!llm) {
      throw new Error(`Model not found: ${id}`);
    }
    return { llm, resolvedModelId: id };
  }

  private async *processOrchestrationStream(
    input: string | any,
    chatId: string,
    signal: AbortSignal | undefined,
    options: AgentRunOptions,
  ): AsyncGenerator<StreamEvent> {
    const agentId = `${chatId}-${Date.now()}`;
    const startTime = Date.now();
    const modelId = options.modelId ?? DEFAULT_ORG_MODEL_ID;
    const skillAllowlist =
      options.skillIds && options.skillIds.length > 0 ? options.skillIds : undefined;
    let resolvedModelId = modelId;
    const runCtx: AgentRunContext | undefined = options.orgTaskId
      ? {
          orgTaskId: options.orgTaskId,
          orgRootTaskId: options.orgRootTaskId ?? options.orgTaskId,
          orgAgentId: options.orgAgentId,
        }
      : undefined;
    let fullText = '';
    let orchestrationComplete = false;
    let skillRouteActive = false;
    try {
      const resolved = await this.resolveRunModel(modelId);
      resolvedModelId = resolved.resolvedModelId;
      const orgTools =
        options.orgAgentId
          ? await (
              await import('../orchestration/orchestration-tools')
            ).buildOrchestrationTools({
              agentId: options.orgAgentId,
              taskId: options.orgTaskId,
            })
          : [];
      const runTools = options.orgTaskId ? orgTools : [...this.lastTools, ...orgTools];
      const runGraph = this.compileGraph(runTools, resolved.llm, skillAllowlist);
      if (!runGraph) {
        yield { type: 'error', data: 'Agent graph not ready for orchestration run.' };
        return;
      }
      const inputStr = typeof input === 'string' ? input : '[orchestration input]';
      agentEvents.emit('agent:started', {
        chatId,
        agentId,
        input: inputStr.substring(0, 200),
        modelId: resolvedModelId,
      });
      yield { type: 'thinking', data: 'Processing orchestration task…' };
      let systemPrompt = await this.buildSystemPromptWithMemory(input, skillAllowlist);
      if (options.orgSystemAppend?.trim()) {
        systemPrompt += options.orgSystemAppend;
      }
      if (signal?.aborted) return;
      await historyManager.loadChat(chatId);
      const inputMessages = {
        messages: [
          new SystemMessage(systemPrompt),
          new HumanMessage({ content: input }),
        ],
      };
      agentEvents.emit('model:inference_start', { chatId, agentId, modelId: resolvedModelId });
      const stream = runGraph.streamEvents(inputMessages, {
        version: 'v2',
        signal,
        recursionLimit: 100,
      });
      const als = getAgentRunStorage();
      async function* iterateStream(): AsyncGenerator<any> {
        try {
          for await (const event of stream) {
            yield event;
          }
        } catch (streamInnerErr: unknown) {
          if (!orchestrationComplete) throw streamInnerErr;
        }
      }
      const streamIterator = iterateStream();
      const closeOrchestrationStream = async (): Promise<void> => {
        try {
          if (runCtx) {
            await als.run(runCtx, () => streamIterator.return(undefined));
          } else {
            await streamIterator.return(undefined);
          }
        } catch (closeErr: unknown) {
          if (!isInferenceInterruptError(closeErr)) {
            console.warn('[Orchestration] stream close:', closeErr);
          }
        }
      };
      let streamStep = runCtx
        ? await als.run(runCtx, () => streamIterator.next())
        : await streamIterator.next();
      while (!streamStep.done) {
        const event = streamStep.value;
        if (signal?.aborted) return;
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
        } else if (event.event === 'on_tool_start' && options.orgTaskId) {
          const toolName = event.name || 'unknown';
          if (toolName === 'web_search' || toolName === 'web_fetch') {
            streamStep = runCtx
              ? await als.run(runCtx, () => streamIterator.next())
              : await streamIterator.next();
            continue;
          }
          if (toolName === 'route_to_skill') {
            skillRouteActive = true;
          }
          yield { type: 'tool_call', data: toolName };
          agentEvents.emit('tool:started', { chatId, agentId, toolName });
          console.log(`[Orchestration] Tool: ${toolName}`);
        } else if (event.event === 'on_tool_end' && options.orgTaskId) {
          const toolName = event.name || 'unknown';
          const toolOutput = extractToolOutputFromEvent(event.data).trim();
          if (toolName === 'route_to_skill') {
            // Nested skill web_search/web_fetch bubble as on_tool_end with parent name route_to_skill.
            // Only finish when the tool actually returned its handoff envelope.
            const isSkillHandoff = toolOutput.includes('[Sub-Agent Result from');
            if (!isSkillHandoff) {
              if (skillRouteActive && toolOutput) {
                console.log(
                  `[Orchestration] Ignoring bubbled tool output during route_to_skill (${toolOutput.length} chars)`,
                );
              }
              streamStep = runCtx
                ? await als.run(runCtx, () => streamIterator.next())
                : await streamIterator.next();
              continue;
            }
            skillRouteActive = false;
            const incomplete = toolOutput.includes(SKILL_RUN_INCOMPLETE_MARKER);
            const failed =
              !incomplete &&
              (toolOutput.includes('No text output produced') ||
                toolOutput.startsWith('Skill crashed:'));
            if (!failed) {
              fullText = toolOutput;
              orchestrationComplete = true;
              if (incomplete) {
                agentEvents.emit('system:log', {
                  chatId,
                  agentId,
                  level: 'warn',
                  message: 'Skill returned partial handoff — task should stay in progress for retry',
                });
              }
              if (runCtx) {
                persistTaskResponse({
                  task: toTaskArtifactScope(runCtx),
                  responderId: options.orgAgentId ?? 'orchestrator',
                  responderType: 'agent',
                  content: toolOutput,
                  agentId: runCtx.orgAgentId,
                  success: true,
                });
              }
              agentEvents.emit('tool:completed', {
                chatId,
                agentId,
                toolName,
                toolResult: toolOutput.substring(0, 200),
              });
              agentEvents.emit('system:log', {
                chatId,
                agentId,
                level: 'info',
                message: `Skill handoff ready (${toolOutput.length} chars) — delegating without parent re-inference`,
              });
              console.log(
                `[Orchestration] route_to_skill handoff (${toolOutput.length} chars) — ending run`,
              );
            }
          } else if (
            toolName !== 'web_search' &&
            toolName !== 'web_fetch' &&
            toolOutput &&
            runCtx
          ) {
            persistTaskResponse({
              task: toTaskArtifactScope(runCtx),
              responderId: toolName,
              responderType: 'tool',
              content: toolOutput,
              agentId: runCtx.orgAgentId,
              success: true,
            });
            agentEvents.emit('tool:completed', {
              chatId,
              agentId,
              toolName,
              toolResult: toolOutput.substring(0, 200),
            });
          }
        } else if (event.event === 'on_chain_end' && event.name === 'agent' && !skillRouteActive) {
          const messages = event.data?.output?.messages as Array<{ content?: unknown }> | undefined;
          if (messages?.length) {
            for (let i = messages.length - 1; i >= 0; i--) {
              const content = messages[i]?.content;
              const text =
                typeof content === 'string'
                  ? content
                  : Array.isArray(content)
                    ? content
                        .map((block: { text?: string }) => block?.text ?? '')
                        .join('')
                    : '';
              if (text.trim()) {
                fullText = text;
                break;
              }
            }
          }
        }
        if (orchestrationComplete) {
          await closeOrchestrationStream();
          break;
        }
        try {
          streamStep = runCtx
            ? await als.run(runCtx, () => streamIterator.next())
            : await streamIterator.next();
        } catch (streamErr: unknown) {
          if (orchestrationComplete || isInferenceInterruptError(streamErr)) break;
          throw streamErr;
        }
      }
      agentEvents.emit('model:inference_end', { chatId, agentId, modelId: resolvedModelId });
      agentEvents.emit('agent:completed', {
        chatId,
        agentId,
        duration: Date.now() - startTime,
        output: fullText.substring(0, 200),
      });
      if (runCtx && options.orgAgentId && fullText.trim()) {
        persistTaskResponse({
          task: toTaskArtifactScope(runCtx),
          responderId: options.orgAgentId,
          responderType: 'agent',
          content: fullText,
          agentId: options.orgAgentId,
          success: true,
        });
      }
      yield { type: 'text_done', data: fullText || 'No output produced.' };
    } catch (error: any) {
      if (orchestrationComplete && fullText.trim()) {
        agentEvents.emit('model:inference_end', { chatId, agentId, modelId: resolvedModelId });
        agentEvents.emit('agent:completed', {
          chatId,
          agentId,
          duration: Date.now() - startTime,
          output: fullText.substring(0, 200),
        });
        if (runCtx && options.orgAgentId) {
          persistTaskResponse({
            task: toTaskArtifactScope(runCtx),
            responderId: options.orgAgentId,
            responderType: 'agent',
            content: fullText,
            agentId: options.orgAgentId,
            success: true,
          });
        }
        yield { type: 'text_done', data: fullText };
        return;
      }
      agentEvents.emit('agent:error', { chatId, agentId, error: error.message });
      yield { type: 'error', data: this.handleError(error) };
    }
  }

  // ── Error handling ─────────────────────────────────────────────────────────

  private handleError(error: any): string {
    const isAbort =
      error?.name === 'AbortError' ||
      error?.message === 'Abort' ||
      (typeof error?.message === 'string' && /aborted|abort/i.test(error.message));
    if (isAbort) {
      console.warn('[ReAct Agent] Processing interrupted (model handoff or cancelled stream).');
      return 'Interrupted by model handoff; the orchestrator will retry on the next heartbeat.';
    }
    console.error('[ReAct Agent] Processing failed:', error);

    // Check for recursion limits caused by massive loops
    if (error.name === 'GraphRecursionError' || error.message?.includes('Recursion limit')) {
      return "I thought very deeply about this, but I hit my multi-step processing limit. Could you simplify the request or ask me to focus on a smaller part?";
    }

    if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      return 'I cannot connect to my brain. Please check that the model server is running.';
    }
    if (typeof error.message === 'string' && /XML syntax error/i.test(error.message)) {
      return 'The model emitted a malformed tool call (Ollama XML parse error). The heartbeat will retry; if this persists, try a different model or shorten prior tool output.';
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
