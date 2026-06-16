import { SkillDefinition, SkillToolLimits } from '../skills/base-skill';
import { StreamEvent } from './react-agent';
import { modelRegistry } from '../models/model-registry';
import { modelRouter } from '../models/model-router';
import type { LlmClient } from '../llm/types';
import { truncateToolOutput } from '../utils/tool-output-truncate';
import { invokeLlmWithDebug } from '../utils/debug-logger';
import { getAgentRunContext, toTaskArtifactScope } from './agent-run-context';
import { persistTaskResponse } from '../orchestration/task-response-store';
import { isInferenceInterruptError } from '../utils/inference-interrupt';
import { softenTools } from '../utils/soften-tool-schema';
import { streamTaoLoop, DEFAULT_TAO_MAX_TURNS } from '../runtime/tao-loop';
import { systemMessage, userMessage } from '../runtime/messages';
import { createOllamaClient } from '../llm/providers/ollama';
import {
  assessStructuredOutput,
  enrichHandoffWithStructuredOutput,
} from './skill-structured-output';
import {
  composeSkillHandoff,
  SKILL_RUN_INCOMPLETE_MARKER,
  type SkillToolTrace,
} from './skill-handoff';
export {
  SKILL_RUN_INCOMPLETE_MARKER,
  composeSkillHandoff,
  extractToolOutputFromEvent,
} from './skill-handoff';

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

export class AgentFactory {
  private llmCache: Map<string, LlmClient> = new Map();

  private async resolveSkillLlm(skill: SkillDefinition): Promise<LlmClient> {
    if (this.llmCache.has(skill.id)) {
      return this.llmCache.get(skill.id)!;
    }
    let llm: LlmClient;
    if (skill.model) {
      const byId = modelRegistry.getById(skill.model);
      if (byId) {
        llm = (await modelRouter.getById(skill.model))!;
      } else {
        llm = createOllamaClient({
          id: skill.model,
          name: skill.model,
          role: 'general',
          provider: 'ollama',
          model: skill.model,
          enabled: true,
          isMaster: false,
        });
      }
    } else {
      llm = await modelRouter.getMasterModel();
    }
    this.llmCache.set(skill.id, llm);
    return llm;
  }

  clearCache() {
    this.llmCache.clear();
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
          systemMessage(skill.systemPrompt),
          userMessage(query),
          userMessage(`${instruction}\n\n--- Collected tool output ---\n\n${appendix}`),
        ],
        { label: `skill-grace:${skill.name}` },
      );
      return response.content.trim();
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

    const llm = await this.resolveSkillLlm(skill);
    const tools = softenTools(skill.tools);

    let fullText = '';
    const toolTraces: SkillToolTrace[] = [];
    const { maxWebSearch, maxWebFetch } = resolveSkillToolLimits(skill);
    let webSearchCount = 0;
    let webFetchCount = 0;
    let skillEndedEarly = false;
    let earlyStopReason = 'tool budget or timeout';
    const deadline = Date.now() + SKILL_RUN_TIMEOUT_MS;
    const abortController = new AbortController();
    const runCtxAtStart = getAgentRunContext();
    if (runCtxAtStart) {
      runCtxAtStart.skillRunCancelled = false;
      runCtxAtStart.lastUserQuery = query.trim();
      runCtxAtStart.webFetchKeys = new Set();
    }

    try {
      for await (const event of streamTaoLoop({
        client: llm,
        plainClient: llm,
        tools,
        messages: [systemMessage(skill.systemPrompt), userMessage(query)],
        label: `skill:${skill.name}`,
        modelId: llm.modelId,
        signal: abortController.signal,
        maxTurns: DEFAULT_TAO_MAX_TURNS,
      })) {
        if (Date.now() > deadline) {
          skillEndedEarly = true;
          earlyStopReason = 'timeout';
          abortController.abort();
          break;
        }
        if (event.type === 'thinking') {
          if (event.data !== 'Processing…') {
            yield { type: 'thinking', data: event.data };
          }
        } else if (event.type === 'token') {
          fullText += event.data;
          yield { type: 'token', data: event.data };
        } else if (event.type === 'tool_call') {
          const toolName = event.data;
          console.log(`[AgentFactory] Skill "${skill.name}" tool: ${toolName}`);
          yield { type: 'tool_call', data: toolName };
          if (toolName === 'web_search') {
            webSearchCount += 1;
            if (webSearchCount > maxWebSearch) {
              console.warn(
                `[AgentFactory] Skill "${skill.name}" hit web_search limit (${maxWebSearch}) — stopping stream`,
              );
              skillEndedEarly = true;
              earlyStopReason = 'web_search limit';
              abortController.abort();
              break;
            }
          }
          if (toolName === 'web_fetch' && maxWebFetch > 0) {
            webFetchCount += 1;
            if (webFetchCount > maxWebFetch) {
              console.warn(
                `[AgentFactory] Skill "${skill.name}" hit web_fetch limit (${maxWebFetch}) — stopping stream`,
              );
              skillEndedEarly = true;
              earlyStopReason = 'web_fetch limit';
              abortController.abort();
              break;
            }
          }
        } else if (event.type === 'tool_result') {
          const toolName = event.data.name;
          const toolOutput = event.data.output.trim();
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
        } else if (event.type === 'done') {
          if (event.data.finalText.trim()) {
            fullText = event.data.finalText;
          }
          if (event.data.endedReason === 'max_turns') {
            skillEndedEarly = true;
            earlyStopReason = 'recursion limit';
            console.warn(
              `[AgentFactory] Skill "${skill.name}" hit TAO max turns (${DEFAULT_TAO_MAX_TURNS}) — stopping with partial output`,
            );
          }
        } else if (event.type === 'error') {
          throw new Error(event.data);
        }
      }

      const runCtx = getAgentRunContext();
      if (runCtx && skillEndedEarly) {
        runCtx.skillRunCancelled = true;
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
      if (!isInferenceInterruptError(error)) {
        console.error(`[AgentFactory] Skill "${skill.name}" stream error:`, error);
      } else {
        skillEndedEarly = true;
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
}
