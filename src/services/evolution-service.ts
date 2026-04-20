/**
 * Evolution Service — Core orchestrator for the VoiceClaw Self-Evolution Pipeline.
 *
 * Handles workspace harvesting, dataset synthesis via Ollama, sample management
 * (pending → approved / rejected), VRAM guard checks, training orchestration,
 * and evolved model version management.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { configManager } from '../config/index';
import { sanitize } from './pii-sanitizer';

// ── Paths ──────────────────────────────────────────────────────────────────────

const WORKSPACE = path.join(process.cwd(), 'workspace');
const EVOLUTION_DIR = path.join(WORKSPACE, 'evolution');
const PENDING_FILE = path.join(EVOLUTION_DIR, 'pending_samples.jsonl');
const VERIFIED_FILE = path.join(EVOLUTION_DIR, 'verified_samples.jsonl');
const REJECTED_FILE = path.join(EVOLUTION_DIR, 'rejected_samples.jsonl');
const HARVEST_STATE_FILE = path.join(EVOLUTION_DIR, 'harvest_state.json');
const TRAINING_HISTORY_FILE = path.join(EVOLUTION_DIR, 'training_history.json');
const MODELS_DIR = path.join(EVOLUTION_DIR, 'models');

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TrainingSample {
  id: string;
  instruction: string;
  output: string;
  sourceFile: string;
  createdAt: string;
  piiRedactions: number;
}

interface HarvestState {
  processedFiles: Record<string, string>; // filepath → content hash
  lastHarvestAt: string;
}

export interface TrainingRun {
  id: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  baseModel: string;
  samplesUsed: number;
  steps: number;
  finalLoss?: number;
  modelPath?: string;
  version?: string;
  error?: string;
}

export interface EvolutionStats {
  totalHarvested: number;
  pendingReview: number;
  approved: number;
  rejected: number;
  trainUnlocked: boolean;
  minSamples: number;
  lastHarvestAt: string | null;
  lastTrainingAt: string | null;
  currentTraining: TrainingRun | null;
}

export interface VRAMStatus {
  safe: boolean;
  usedMB: number;
  thresholdMB: number;
}

export interface EvolvedModel {
  version: string;
  trainedAt: string;
  baseModel: string;
  samplesUsed: number;
  steps: number;
  finalLoss?: number;
  modelPath: string;
  active: boolean;
}

// ── File Extensions to Scan ────────────────────────────────────────────────────

const SCANNABLE_EXTENSIONS = new Set([
  '.ts', '.js', '.dart', '.py', '.md', '.json', '.yaml', '.yml',
  '.html', '.css', '.sh', '.ps1', '.bat',
]);

// Config / user-data files/dirs to SKIP during harvest
const SKIP_PATTERNS = [
  'config.json',
  'models-config.json',
  'channels.json',
  'memory.json',
  'notifications.json',
  'pipeline-history.json',
  'pipelines.json',
  '.env',
  'node_modules',
  '.git',
  'dist',
  'build',
  'evolution',        // Don't scan our own output
  'whatsapp_auth',
  'cache',
  'chats',            // User conversation data
  'outputs',          // Pipeline output data
  'package-lock.json',
  'yarn.lock',
  'pubspec.lock',
];

// ── Utility ────────────────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

function generateId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function shouldSkip(filePath: string): boolean {
  const rel = path.relative(WORKSPACE, filePath).replace(/\\/g, '/');
  for (const pattern of SKIP_PATTERNS) {
    if (rel === pattern || rel.startsWith(pattern + '/') || rel.includes('/' + pattern + '/') || rel.includes('/' + pattern)) {
      return true;
    }
  }
  // Skip screenshots and binary media
  const ext = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.wav', '.mp3', '.gguf', '.bin'].includes(ext)) {
    return true;
  }
  return false;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

async function appendJsonl(filePath: string, item: any): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, JSON.stringify(item) + '\n', 'utf-8');
}

async function writeJsonl(filePath: string, items: any[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, items.map(i => JSON.stringify(i)).join('\n') + '\n', 'utf-8');
}

// ── Service ────────────────────────────────────────────────────────────────────

class EvolutionService {
  private currentTraining: TrainingRun | null = null;
  private trainingProcess: ChildProcess | null = null;

  // ── Workspace Harvesting ─────────────────────────────────────────────────

  /**
   * Recursively scan workspace for code/doc files and generate training pairs
   * using the local Ollama LLM. Skips config files, user data, and already-processed files.
   */
  async harvestWorkspace(): Promise<{ newPairs: number; skipped: number; errors: number }> {
    await fs.mkdir(EVOLUTION_DIR, { recursive: true });
    const state = await this.loadHarvestState();
    const files = await this.scanDirectory(WORKSPACE);

    let newPairs = 0;
    let skipped = 0;
    let errors = 0;

    for (const filePath of files) {
      if (shouldSkip(filePath)) {
        skipped++;
        continue;
      }

      const ext = path.extname(filePath).toLowerCase();
      if (!SCANNABLE_EXTENSIONS.has(ext)) {
        skipped++;
        continue;
      }

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        if (content.length < 20 || content.length > 50000) {
          skipped++;
          continue;
        }

        const hash = hashContent(content);
        const relPath = path.relative(WORKSPACE, filePath);

        // Skip if already processed with same content
        if (state.processedFiles[relPath] === hash) {
          skipped++;
          continue;
        }

        // Generate training pair via Ollama
        const pair = await this.generateTrainingPair(content, relPath, ext);
        if (pair) {
          // Sanitize PII
          const instrResult = sanitize(pair.instruction);
          const outResult = sanitize(pair.output);
          const totalRedactions = instrResult.redactions + outResult.redactions;

          const sample: TrainingSample = {
            id: generateId(),
            instruction: instrResult.cleaned,
            output: outResult.cleaned,
            sourceFile: relPath,
            createdAt: new Date().toISOString(),
            piiRedactions: totalRedactions,
          };

          // Validate before saving
          if (this.validatePair(sample)) {
            await appendJsonl(PENDING_FILE, sample);
            newPairs++;
          }
        }

        state.processedFiles[relPath] = hash;
      } catch (err: any) {
        console.error(`[Evolution] Failed to process ${filePath}:`, err.message);
        errors++;
      }
    }

    state.lastHarvestAt = new Date().toISOString();
    await this.saveHarvestState(state);

    console.log(`[Evolution] Harvest complete: ${newPairs} new pairs, ${skipped} skipped, ${errors} errors`);
    return { newPairs, skipped, errors };
  }

  private async scanDirectory(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!shouldSkip(fullPath)) {
            results.push(...await this.scanDirectory(fullPath));
          }
        } else {
          results.push(fullPath);
        }
      }
    } catch { }
    return results;
  }

  private async generateTrainingPair(
    content: string,
    relPath: string,
    ext: string,
  ): Promise<{ instruction: string; output: string } | null> {
    const language = this.getLanguageName(ext);
    const snippet = content.substring(0, 4000); // Cap to avoid Ollama context overflow

    const prompt = `You are a dataset synthesis assistant. Convert this ${language} code/file into a high-quality training pair.

Source file: ${relPath}

\`\`\`${language}
${snippet}
\`\`\`

Generate a JSON object with exactly two fields:
- "instruction": A clear, natural question or task description that this code answers (e.g., "How do I implement X?", "Create a Y that does Z")
- "output": The cleaned, well-formatted version of the code that answers the instruction

Rules:
- The instruction must describe the INTENT, not just "what is this file"
- The output should be self-contained and useful as a code example
- Keep the output concise — trim imports and boilerplate if not central
- Return ONLY the JSON object, no extra text

JSON:`;

    try {
      const config = configManager.getConfig();
      const ollamaModel = config.llm?.model || 'llama3.1';
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          prompt,
          stream: false,
          options: { temperature: 0.3 },
        }),
      });

      if (!response.ok) return null;
      const data = await response.json() as { response?: string };
      const text = (data.response || '').trim();

      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.instruction && parsed.output) {
        // Coerce to string — LLM may return objects/arrays instead of strings
        const instruction = typeof parsed.instruction === 'string'
          ? parsed.instruction
          : JSON.stringify(parsed.instruction);
        const output = typeof parsed.output === 'string'
          ? parsed.output
          : JSON.stringify(parsed.output);
        return { instruction, output };
      }
    } catch (err: any) {
      console.warn(`[Evolution] Training pair generation failed for ${relPath}:`, err.message);
    }

    return null;
  }

  private getLanguageName(ext: string): string {
    const map: Record<string, string> = {
      '.ts': 'TypeScript', '.js': 'JavaScript', '.dart': 'Dart',
      '.py': 'Python', '.md': 'Markdown', '.json': 'JSON',
      '.yaml': 'YAML', '.yml': 'YAML', '.html': 'HTML',
      '.css': 'CSS', '.sh': 'Shell', '.ps1': 'PowerShell', '.bat': 'Batch',
    };
    return map[ext] || 'text';
  }

  /**
   * Validate a training pair — reject empty/broken/too-long samples.
   */
  private validatePair(sample: TrainingSample): boolean {
    if (!sample.instruction || sample.instruction.trim().length < 10) return false;
    if (!sample.output || sample.output.trim().length < 10) return false;
    if (sample.instruction.length > 500) return false;
    if (sample.output.length > 8000) return false;
    // Reject if output is mostly redacted
    const redactedRatio = (sample.output.match(/\[REDACTED_/g) || []).length / sample.output.split(' ').length;
    if (redactedRatio > 0.3) return false;
    return true;
  }

  // ── Harvest State Persistence ────────────────────────────────────────────

  private async loadHarvestState(): Promise<HarvestState> {
    try {
      const content = await fs.readFile(HARVEST_STATE_FILE, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { processedFiles: {}, lastHarvestAt: '' };
    }
  }

  private async saveHarvestState(state: HarvestState): Promise<void> {
    await fs.mkdir(EVOLUTION_DIR, { recursive: true });
    await fs.writeFile(HARVEST_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * Wipe all harvest data — pending, verified, rejected samples and the
   * file-hash state so the next harvest re-scans everything from scratch.
   */
  async resetHarvest(options: { keepVerified?: boolean } = {}): Promise<void> {
    await fs.unlink(PENDING_FILE).catch(() => {});
    await fs.unlink(REJECTED_FILE).catch(() => {});
    await fs.unlink(HARVEST_STATE_FILE).catch(() => {});
    if (!options.keepVerified) {
      await fs.unlink(VERIFIED_FILE).catch(() => {});
    }
    console.log(`[Evolution] Harvest reset.${options.keepVerified ? ' Verified samples preserved.' : ''}`);
  }

  // ── Sample Review Queue ──────────────────────────────────────────────────

  async getReviewQueue(page: number = 1, limit: number = 20): Promise<{ samples: TrainingSample[]; total: number }> {
    const all = await readJsonl<TrainingSample>(PENDING_FILE);
    const total = all.length;
    const start = (page - 1) * limit;
    return { samples: all.slice(start, start + limit), total };
  }

  async approveSample(id: string): Promise<boolean> {
    const pending = await readJsonl<TrainingSample>(PENDING_FILE);
    const idx = pending.findIndex(s => s.id === id);
    if (idx === -1) return false;

    const sample = pending.splice(idx, 1)[0];
    await writeJsonl(PENDING_FILE, pending);
    await appendJsonl(VERIFIED_FILE, sample);
    return true;
  }

  async rejectSample(id: string): Promise<boolean> {
    const pending = await readJsonl<TrainingSample>(PENDING_FILE);
    const idx = pending.findIndex(s => s.id === id);
    if (idx === -1) return false;

    const sample = pending.splice(idx, 1)[0];
    await writeJsonl(PENDING_FILE, pending);
    await appendJsonl(REJECTED_FILE, sample);
    return true;
  }

  async approveBatch(ids: string[]): Promise<number> {
    let approved = 0;
    for (const id of ids) {
      if (await this.approveSample(id)) approved++;
    }
    return approved;
  }

  async rejectBatch(ids: string[]): Promise<number> {
    let rejected = 0;
    for (const id of ids) {
      if (await this.rejectSample(id)) rejected++;
    }
    return rejected;
  }

  // ── Statistics ───────────────────────────────────────────────────────────

  async getStats(): Promise<EvolutionStats> {
    const config = configManager.getConfig();
    const minSamples = (config as any).evolution?.minSamples ?? 100;

    const pending = await readJsonl<TrainingSample>(PENDING_FILE);
    const verified = await readJsonl<TrainingSample>(VERIFIED_FILE);
    const rejected = await readJsonl<TrainingSample>(REJECTED_FILE);
    const state = await this.loadHarvestState();
    const history = await this.loadTrainingHistory();

    const lastRun = history.length > 0 ? history[0].startedAt : null;

    return {
      totalHarvested: pending.length + verified.length + rejected.length,
      pendingReview: pending.length,
      approved: verified.length,
      rejected: rejected.length,
      trainUnlocked: verified.length >= minSamples,
      minSamples,
      lastHarvestAt: state.lastHarvestAt || null,
      lastTrainingAt: lastRun,
      currentTraining: this.currentTraining,
    };
  }

  // ── VRAM Guard ───────────────────────────────────────────────────────────

  async checkVRAMGuard(): Promise<VRAMStatus> {
    const config = configManager.getConfig();
    const thresholdMB = (config as any).evolution?.vramMaxMB ?? 2048;

    try {
      const result = await new Promise<string>((resolve, reject) => {
        const proc = spawn('nvidia-smi', [
          '--query-gpu=memory.used',
          '--format=csv,noheader,nounits',
        ]);
        let output = '';
        proc.stdout.on('data', (data) => { output += data.toString(); });
        proc.stderr.on('data', (data) => { console.warn('[VRAM]', data.toString()); });
        proc.on('close', (code) => {
          if (code === 0) resolve(output.trim());
          else reject(new Error(`nvidia-smi exited with code ${code}`));
        });
        proc.on('error', reject);
      });

      const usedMB = parseInt(result.split('\n')[0], 10) || 0;
      return { safe: usedMB < thresholdMB, usedMB, thresholdMB };
    } catch {
      // nvidia-smi not available — assume safe (CPU-only or no GPU)
      return { safe: true, usedMB: 0, thresholdMB };
    }
  }

  // ── Training Orchestration ───────────────────────────────────────────────

  async startTraining(): Promise<TrainingRun> {
    if (this.currentTraining?.status === 'running') {
      throw new Error('Training is already in progress.');
    }

    const stats = await this.getStats();
    if (!stats.trainUnlocked) {
      throw new Error(`Not enough approved samples. Need ${stats.minSamples}, have ${stats.approved}.`);
    }

    const vram = await this.checkVRAMGuard();
    if (!vram.safe) {
      throw new Error(`VRAM usage too high (${vram.usedMB}MB / ${vram.thresholdMB}MB threshold). Close other GPU apps first.`);
    }

    const config = configManager.getConfig();
    const evoConfig = (config as any).evolution || {};
    const version = `v${Date.now()}`;
    const outputDir = path.join(MODELS_DIR, `voiceclaw-${version}`);

    const run: TrainingRun = {
      id: generateId(),
      startedAt: new Date().toISOString(),
      status: 'running',
      baseModel: evoConfig.baseModel || 'unsloth/llama-3.1-8b-bnb-4bit',
      samplesUsed: stats.approved,
      steps: evoConfig.maxTrainSteps || 60,
      version,
    };

    this.currentTraining = run;

    // Determine Python executable (use venv if available)
    const venvPython = path.join(process.cwd(), 'scripts', 'evolution-venv', 'Scripts', 'python.exe');
    const pythonExe = fsSync.existsSync(venvPython) ? venvPython : 'python';

    const args = [
      path.join(process.cwd(), 'scripts', 'train_model.py'),
      '--data-path', VERIFIED_FILE,
      '--output-dir', outputDir,
      '--max-steps', String(run.steps),
      '--lora-rank', String(evoConfig.loraRank || 16),
      '--learning-rate', String(evoConfig.learningRate || 2e-4),
      '--quant-method', evoConfig.quantMethod || 'q4_k_m',
      '--base-model', run.baseModel,
    ];

    console.log(`[Evolution] Starting training: ${pythonExe} ${args.join(' ')}`);

    this.trainingProcess = spawn(pythonExe, args, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    let stdoutBuffer = '';

    this.trainingProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdoutBuffer += text;
      console.log(`[Evolution Train] ${text.trim()}`);
    });

    this.trainingProcess.stderr?.on('data', (data: Buffer) => {
      console.warn(`[Evolution Train STDERR] ${data.toString().trim()}`);
    });

    this.trainingProcess.on('close', async (code: number | null) => {
      if (code === 0) {
        run.status = 'completed';
        run.completedAt = new Date().toISOString();
        run.modelPath = outputDir;

        // Try to parse metrics from stdout
        try {
          const metricsMatch = stdoutBuffer.match(/METRICS:\s*(\{.*\})/);
          if (metricsMatch) {
            const metrics = JSON.parse(metricsMatch[1]);
            run.finalLoss = metrics.finalLoss;
          }
        } catch { }

        console.log(`[Evolution] Training completed successfully. Model at: ${outputDir}`);

        // Auto-register with Ollama
        await this.registerWithOllama(outputDir, version).catch(e => {
          console.error('[Evolution] Ollama registration failed:', e.message);
        });
      } else {
        run.status = 'failed';
        run.completedAt = new Date().toISOString();
        run.error = `Training process exited with code ${code}`;
        console.error(`[Evolution] Training failed with exit code ${code}`);
      }

      // Save to history
      const history = await this.loadTrainingHistory();
      history.unshift(run);
      await this.saveTrainingHistory(history.slice(0, 50));
      this.currentTraining = null;
      this.trainingProcess = null;
    });

    this.trainingProcess.on('error', async (err: Error) => {
      run.status = 'failed';
      run.completedAt = new Date().toISOString();
      run.error = err.message;
      console.error(`[Evolution] Training process error:`, err.message);

      const history = await this.loadTrainingHistory();
      history.unshift(run);
      await this.saveTrainingHistory(history.slice(0, 50));
      this.currentTraining = null;
      this.trainingProcess = null;
    });

    return run;
  }

  getTrainingStatus(): TrainingRun | null {
    return this.currentTraining;
  }

  // ── Ollama Hot-Swap ──────────────────────────────────────────────────────

  private async registerWithOllama(modelDir: string, version: string): Promise<void> {
    // Find the GGUF file in the output directory
    const files = await fs.readdir(modelDir).catch(() => [] as string[]);
    const ggufFile = files.find(f => f.endsWith('.gguf'));
    if (!ggufFile) {
      console.warn('[Evolution] No GGUF file found in output directory. Skipping Ollama registration.');
      return;
    }

    const ggufPath = path.join(modelDir, ggufFile);
    const modelfilePath = path.join(modelDir, 'Modelfile');

    // Generate Modelfile
    const modelfileContent = `FROM ${ggufPath}\nSYSTEM "You are VoiceClaw, a personalized AI assistant fine-tuned on your owner's coding style and preferences."\nPARAMETER temperature 0.2\nPARAMETER num_ctx 2048\n`;
    await fs.writeFile(modelfilePath, modelfileContent, 'utf-8');

    console.log(`[Evolution] Registering with Ollama: voiceclaw-evolved-${version}`);

    return new Promise((resolve, reject) => {
      const proc = spawn('ollama', ['create', `voiceclaw-evolved-${version}`, '-f', modelfilePath]);
      proc.stdout.on('data', (data) => console.log(`[Ollama] ${data.toString().trim()}`));
      proc.stderr.on('data', (data) => console.warn(`[Ollama] ${data.toString().trim()}`));
      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`[Evolution] Ollama model registered: voiceclaw-evolved-${version}`);
          resolve();
        } else {
          reject(new Error(`ollama create exited with code ${code}`));
        }
      });
      proc.on('error', reject);
    });
  }

  // ── Model Version Management ─────────────────────────────────────────────

  async listEvolvedModels(): Promise<EvolvedModel[]> {
    const history = await this.loadTrainingHistory();
    const models: EvolvedModel[] = [];

    // Check which model is currently active in the models-config
    const { modelRegistry } = await import('../models/model-registry');
    const allModels = modelRegistry.getAll();
    const activeEvolved = allModels.find(m => m.id.startsWith('evolved-') && m.isMaster);

    for (const run of history) {
      if (run.status !== 'completed' || !run.version || !run.modelPath) continue;
      models.push({
        version: run.version,
        trainedAt: run.completedAt || run.startedAt,
        baseModel: run.baseModel,
        samplesUsed: run.samplesUsed,
        steps: run.steps,
        finalLoss: run.finalLoss,
        modelPath: run.modelPath,
        active: activeEvolved?.model?.includes(run.version) || false,
      });
    }

    return models;
  }

  async activateEvolvedModel(version: string): Promise<boolean> {
    const { modelRegistry } = await import('../models/model-registry');
    const modelName = `voiceclaw-evolved-${version}`;

    // Add or update in model registry
    const config = {
      id: `evolved-${version}`,
      name: modelName,
      role: 'master' as const,
      provider: 'ollama' as const,
      model: modelName,
      baseUrl: 'http://localhost:11434',
      enabled: true,
      isMaster: true,
    };

    await modelRegistry.addOrUpdate(config);
    await modelRegistry.setMaster(config.id);
    console.log(`[Evolution] Activated evolved model: ${modelName}`);
    return true;
  }

  async rollbackToBase(): Promise<boolean> {
    const { modelRegistry } = await import('../models/model-registry');
    const allModels = modelRegistry.getAll();

    // Find the first non-evolved model to promote back to master
    const baseModel = allModels.find(m => !m.id.startsWith('evolved-') && m.enabled);
    if (!baseModel) {
      console.error('[Evolution] No base model found to rollback to.');
      return false;
    }

    await modelRegistry.setMaster(baseModel.id);
    console.log(`[Evolution] Rolled back to base model: ${baseModel.name}`);
    return true;
  }

  // ── Training History ─────────────────────────────────────────────────────

  private async loadTrainingHistory(): Promise<TrainingRun[]> {
    try {
      const content = await fs.readFile(TRAINING_HISTORY_FILE, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  private async saveTrainingHistory(history: TrainingRun[]): Promise<void> {
    await fs.mkdir(EVOLUTION_DIR, { recursive: true });
    await fs.writeFile(TRAINING_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  }
}

export const evolutionService = new EvolutionService();
