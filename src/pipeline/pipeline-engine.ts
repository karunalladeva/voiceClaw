import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { agentEvents } from '../admin/agent-events';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JobHistoryEntry {
  pipelineId: string;
  pipelineName: string;
  ranAt: number;
  success: boolean;
  stepResults: { type: string; success: boolean; output: string }[];
}

export interface PipelineStep {
  /** Step type — determines which executor runs */
  type: 'ai_task' | 'research' | 'browse' | 'summarize' | 'generate_doc' | 'deliver' | 'save_history';
  /** Step-specific config (prompt, url, channel, template path, etc.) */
  config: Record<string, any>;
}

export interface Pipeline {
  id: string;
  name: string;
  /** Trigger type */
  trigger: 'scheduled' | 'manual' | 'on_event';
  /** 
   * Schedule string. Supported formats:
   * - "every 30 minutes", "every 2 hours", "every day 09:00"
   * - ISO datetime for one-time: "2025-06-01T09:00:00"
   */
  schedule?: string;
  steps: PipelineStep[];
  enabled: boolean;
  runOnStartup?: boolean;
  createdAt: number;
  lastRun?: number;
  nextRun?: number;
}

export interface StepResult {
  success: boolean;
  output: string;
  data?: any;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const PIPELINES_FILE = path.join(process.cwd(), 'workspace', 'pipelines.json');
const HISTORY_FILE = path.join(process.cwd(), 'workspace', 'pipeline-history.json');
const TEMPLATE_ROOT = path.join(process.cwd(), 'template');

export interface PipelineTemplate {
  id: string;
  name: string;
  category: string;
  description?: string;
  steps: PipelineStep[];
}

export async function loadPipelines(): Promise<Pipeline[]> {
  try {
    if (fsSync.existsSync(PIPELINES_FILE)) {
      return JSON.parse(await fs.readFile(PIPELINES_FILE, 'utf-8'));
    }
  } catch { }
  return [];
}

export async function loadPipelineTemplates(): Promise<PipelineTemplate[]> {
  const templates: PipelineTemplate[] = [];
  try {
    if (!fsSync.existsSync(TEMPLATE_ROOT)) {
      return loadLegacyTemplatesFallback();
    }
    const files = collectTemplateFiles(TEMPLATE_ROOT);
    for (const file of files) {
      try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as Partial<PipelineTemplate>;
        if (!parsed.id || !parsed.name || !Array.isArray(parsed.steps)) continue;
        const relative = path.relative(TEMPLATE_ROOT, file);
        const folderCategory = path.dirname(relative).replace(/\\/g, '/');
        templates.push({
          id: parsed.id,
          name: parsed.name,
          description: parsed.description,
          category: parsed.category || (folderCategory === '.' ? 'general' : folderCategory),
          steps: parsed.steps as PipelineStep[],
        });
      } catch {
        // Skip malformed template files, do not break runtime.
      }
    }
  } catch {
    return loadLegacyTemplatesFallback();
  }
  if (templates.length === 0) {
    return loadLegacyTemplatesFallback();
  }
  return templates;
}

async function loadLegacyTemplatesFallback(): Promise<PipelineTemplate[]> {
  const pipelines = await loadPipelines();
  return pipelines.map((pipeline: Pipeline) => ({
    id: `legacy-${pipeline.id}`,
    name: `${pipeline.name} (Legacy Template)`,
    category: 'legacy/workspace',
    description: 'Auto-derived from workspace/pipelines.json for backward compatibility.',
    steps: pipeline.steps,
  }));
}

function collectTemplateFiles(rootDir: string, acc: string[] = []): string[] {
  const entries = fsSync.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collectTemplateFiles(full, acc);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      acc.push(full);
    }
  }
  return acc;
}

export async function savePipelines(pipelines: Pipeline[]): Promise<void> {
  await fs.mkdir(path.dirname(PIPELINES_FILE), { recursive: true });
  await fs.writeFile(PIPELINES_FILE, JSON.stringify(pipelines, null, 2), 'utf-8');
}

export async function loadHistory(): Promise<JobHistoryEntry[]> {
  try {
    if (fsSync.existsSync(HISTORY_FILE)) {
      return JSON.parse(await fs.readFile(HISTORY_FILE, 'utf-8'));
    }
  } catch { }
  return [];
}

async function appendHistory(entry: JobHistoryEntry): Promise<void> {
  const history = await loadHistory();
  history.unshift(entry); // newest first
  // Keep last 100 entries
  const trimmed = history.slice(0, 100);
  await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  await fs.writeFile(HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
}

// ── Schedule Parsing ──────────────────────────────────────────────────────────

export function parseScheduleMs(schedule: string): number {
  const s = schedule.toLowerCase().trim();

  // "every N minutes"
  const minMatch = s.match(/every\s+(\d+)\s*min/);
  if (minMatch) return parseInt(minMatch[1]) * 60_000;

  // "every N hours"
  const hourMatch = s.match(/every\s+(\d+)\s*hour/);
  if (hourMatch) return parseInt(hourMatch[1]) * 3_600_000;

  // "every hour"
  if (s.includes('every hour')) return 3_600_000;

  // "every day"
  if (s.includes('every day') || s.includes('daily')) return 86_400_000;

  // "every week"  
  if (s.includes('every week') || s.includes('weekly')) return 604_800_000;

  // "every minute"
  if (s.includes('every minute')) return 60_000;

  // fallback: treat as minutes
  const n = parseInt(s);
  if (!isNaN(n)) return n * 60_000;

  return 3_600_000; // default 1 hour
}

export function computeNextRun(pipeline: Pipeline): number {
  if (!pipeline.schedule) return 0;
  const now = Date.now();

  // Check if it's an ISO date (one-time)
  const d = new Date(pipeline.schedule);
  if (!isNaN(d.getTime()) && pipeline.schedule.includes('T')) {
    return d.getTime();
  }

  // Recurring
  const intervalMs = parseScheduleMs(pipeline.schedule);
  const base = pipeline.lastRun ?? now;
  return base + intervalMs;
}

// ── Step Executors ────────────────────────────────────────────────────────────
// Each step receives context (output from previous step) and returns a StepResult.
// Actual implementations load lazily to keep this module lightweight.

type StepExecutor = (config: Record<string, any>, context: string) => Promise<StepResult>;

const stepRegistry: Record<string, StepExecutor> = {};

export function registerStep(type: string, executor: StepExecutor) {
  stepRegistry[type] = executor;
}

// ── Pipeline Runner ───────────────────────────────────────────────────────────

export async function runPipeline(pipeline: Pipeline): Promise<{ success: boolean; outputs: StepResult[] }> {
  const { modelLoadCoordinator } = await import('../models/model-load-coordinator');
  if (modelLoadCoordinator.isGpuHandoffActive()) {
    console.log(`[Pipeline] Deferred "${pipeline.name}" — ComfyUI generation using GPU`);
    return { success: false, outputs: [] };
  }
  console.log(`[Pipeline] ▶ Running "${pipeline.name}" (${pipeline.steps.length} steps)`);
  const outputs: StepResult[] = [];
  let context = '';
  const pipelineRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[Pipeline] Run ID: ${pipelineRunId}`);

  for (let i = 0; i < pipeline.steps.length; i++) {
    const step = pipeline.steps[i];
    const executor = stepRegistry[step.type];

    if (!executor) {
      const msg = `Step ${i + 1} (${step.type}) — no executor registered. Skipping.`;
      console.warn(`[Pipeline] ${msg}`);
      outputs.push({ success: false, output: msg });
      continue;
    }

    try {
      console.log(`[Pipeline]   Step ${i + 1}/${pipeline.steps.length}: ${step.type}`);
      const stepConfig = {
        ...(step.config || {}),
        __pipelineId: pipeline.id,
        __pipelineName: pipeline.name,
        __pipelineRunId: pipelineRunId,
        __pipelineStepIndex: i,
      };
      const result = await executor(stepConfig, context);
      outputs.push(result);
      context = result.output; // chain output → next step input
      agentEvents.log(
        result.success ? 'info' : 'warn',
        `[Pipeline] Step ${i + 1}/${pipeline.steps.length} (${step.type}): ${result.success ? 'OK' : 'FAILED'}`,
        { pipelineId: pipeline.id, pipelineName: pipeline.name, stepType: step.type, stepIndex: i }
      );
    } catch (err: any) {
      const msg = `Step ${i + 1} (${step.type}) failed: ${err.message}`;
      console.error(`[Pipeline] ${msg}`);
      outputs.push({ success: false, output: msg });
      // Continue remaining steps with error context
      context = `[ERROR] ${msg}`;
    }
  }

  // Update pipeline state
  pipeline.lastRun = Date.now();
  if (pipeline.trigger === 'scheduled' && pipeline.schedule) {
    pipeline.nextRun = computeNextRun(pipeline);
  }

  const deliverSucceeded = outputs.some(
    (output, index) => pipeline.steps[index]?.type === 'deliver' && output.success
  );
  const contentSteps = outputs.filter(
    (_, index) => !['deliver', 'save_history'].includes(pipeline.steps[index]?.type || '')
  );
  const hasMeaningfulOutput = contentSteps.some(
    (output) => output.success && output.output.trim().length > 80
  );
  const allStepsPassed = outputs.every((output) => output.success);
  const success = allStepsPassed || (deliverSucceeded && hasMeaningfulOutput);
  const failedStepTypes = outputs
    .map((output, index) => ({ output, type: pipeline.steps[index]?.type || 'unknown' }))
    .filter((entry) => !entry.output.success)
    .map((entry) => entry.type);

  if (failedStepTypes.length > 0 && success) {
    console.log(
      `[Pipeline] "${pipeline.name}" completed with warnings — failed steps: ${failedStepTypes.join(', ')}`
    );
  }
  console.log(
    `[Pipeline] ■ "${pipeline.name}" finished — ${success ? (allStepsPassed ? '✅ all passed' : '✅ delivered (some steps skipped/failed)') : '⚠️ failed'}`
  );

  // Append to job history
  await appendHistory({
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    ranAt: Date.now(),
    success: success,
    // Truncation here is log-only for history storage size control.
    // It does not affect what gets delivered to channels/history chats during step execution.
    stepResults: outputs.map((o, i) => ({ type: pipeline.steps[i]?.type || 'unknown', success: o.success, output: o.output.substring(0, 500) })),
  });

  return { success: success, outputs };
}

// ── Pipeline Ticker ───────────────────────────────────────────────────────────

let _pipelineTicker: NodeJS.Timeout | null = null;

export function startPipelineTicker(): void {
  if (_pipelineTicker) return;

  _pipelineTicker = setInterval(async () => {
    const pipelines = await loadPipelines();
    const now = Date.now();
    let changed = false;

    for (const p of pipelines) {
      if (!p.enabled || p.trigger !== 'scheduled') continue;
      const due = p.nextRun ?? computeNextRun(p);
      if (now == due) {
        await runPipeline(p);
        changed = true;
      }
    }

    if (changed) {
      await savePipelines(pipelines);
    }
  }, 30_000); // check every 30s

  console.log('[Pipeline] Ticker started (30s interval).');

  // One-time startup check for runOnStartup pipelines
  setTimeout(async () => {
    try {
      const pipelines = await loadPipelines();
      let changed = false;
      for (const p of pipelines) {
        if (p.enabled && p.runOnStartup) {
          console.log(`[Pipeline] Running startup pipeline: ${p.name}`);
          await runPipeline(p);
          changed = true;
        }
      }
      if (changed) await savePipelines(pipelines);
    } catch (e) {
      console.error('[Pipeline] Error running startup pipelines:', e);
    }
  }, 5000); // 5s after boot to ensure services are ready
}
