import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { configManager } from '../config/index';

export interface ComfyUIPromptResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, unknown>;
}

export interface ComfyUIHistoryOutput {
  filename: string;
  subfolder: string;
  type: string;
}

export interface ComfyUIHistoryEntry {
  outputs?: Record<string, { images?: ComfyUIHistoryOutput[]; gifs?: ComfyUIHistoryOutput[]; videos?: ComfyUIHistoryOutput[] }>;
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
}

export interface ComfyUIQueueStatus {
  queue_running: unknown[][];
  queue_pending: unknown[][];
}

export interface WaitForCompletionOptions {
  timeoutMs?: number;
  onProgress?: (message: string) => void;
  clientId?: string;
}

interface ComfyNodeValidationError {
  type?: string;
  message?: string;
  details?: string;
  extra_info?: {
    input_name?: string;
    received_value?: string;
  };
}

interface ComfyNodeErrorEntry {
  errors?: ComfyNodeValidationError[];
  class_type?: string;
}

const MODEL_FIELD_TO_FOLDER: Record<string, string> = {
  ckpt_name: 'checkpoints',
  clip_name: 'text_encoders',
  unet_name: 'diffusion_models',
  vae_name: 'vae',
};

function formatNodeValidationErrors(nodeId: string, nodeError: ComfyNodeErrorEntry): string[] {
  const lines: string[] = [];
  const classType = nodeError.class_type ?? 'Node';
  for (const err of nodeError.errors ?? []) {
    const field = err.extra_info?.input_name;
    const modelName = err.extra_info?.received_value;
    const folder = field ? MODEL_FIELD_TO_FOLDER[field] : undefined;
    if (err.type === 'value_not_in_list' && folder && modelName) {
      lines.push(`${classType} [${nodeId}]: "${modelName}" not found — install to ComfyUI/models/${folder}/`);
      continue;
    }
    lines.push(`${classType} [${nodeId}]: ${err.details ?? err.message ?? 'validation failed'}`);
  }
  return lines;
}

function formatComfyUIErrorBody(body: unknown): string {
  if (body === null || body === undefined) return 'empty response';
  if (typeof body === 'string') return body;
  if (typeof body !== 'object') return String(body);
  const obj = body as Record<string, unknown>;
  const nodeErrors = obj.node_errors;
  if (nodeErrors && typeof nodeErrors === 'object' && Object.keys(nodeErrors as object).length > 0) {
    const lines: string[] = [];
    for (const [nodeId, entry] of Object.entries(nodeErrors as Record<string, ComfyNodeErrorEntry>)) {
      lines.push(...formatNodeValidationErrors(nodeId, entry));
    }
    if (lines.length > 0) {
      return `ComfyUI workflow validation failed (models missing on server):\n${lines.join('\n')}`;
    }
    return JSON.stringify(nodeErrors);
  }
  if (obj.error !== undefined) {
    if (typeof obj.error === 'string') return obj.error;
    return JSON.stringify(obj.error);
  }
  return JSON.stringify(body);
}

interface ComfyUIWsMessage {
  type?: string;
  data?: {
    prompt_id?: string;
    node?: string | null;
    exception_message?: string;
    value?: number;
    max?: number;
    status?: { exec_info?: { queue_remaining?: number } };
    sid?: string;
  };
}

interface ComfyUIWsHandlerContext {
  label: string;
  clientId: string;
  expectedPromptId?: string;
}

interface ComfyUIWsHandlerResult {
  finished: boolean;
  error?: string;
  progressMessage?: string;
}

interface ComfyUIBinaryPreviewInfo {
  eventType: number;
  imageFormat?: number;
  imageBytes: number;
  meta?: Record<string, unknown>;
}

const COMFYUI_BINARY_PREVIEW_EVENT = 1;
const COMFYUI_BINARY_PREVIEW_UNENCODED = 2;
const previewFrameCounts = new Map<string, number>();

function toBuffer(raw: WebSocket.Data): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw as unknown as Uint8Array);
}

function tryParseJsonWsMessage(raw: WebSocket.Data): ComfyUIWsMessage | null {
  const text = typeof raw === 'string' ? raw : toBuffer(raw).toString('utf8');
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(text) as ComfyUIWsMessage;
  } catch {
    return null;
  }
}

function parseComfyUIBinaryMessage(raw: WebSocket.Data): ComfyUIBinaryPreviewInfo | null {
  const buffer = toBuffer(raw);
  if (buffer.length < 8) return null;
  const eventType = buffer.readUInt32BE(0);
  if (eventType !== COMFYUI_BINARY_PREVIEW_EVENT && eventType !== COMFYUI_BINARY_PREVIEW_UNENCODED) {
    return null;
  }
  if (eventType === COMFYUI_BINARY_PREVIEW_EVENT) {
    const imageFormat = buffer.readUInt32BE(4);
    return { eventType, imageFormat, imageBytes: buffer.length - 8 };
  }
  const jsonLen = buffer.readUInt32BE(4);
  if (jsonLen > 0 && 8 + jsonLen <= buffer.length) {
    try {
      const meta = JSON.parse(buffer.subarray(8, 8 + jsonLen).toString('utf8')) as Record<string, unknown>;
      return { eventType, imageBytes: buffer.length - 8 - jsonLen, meta };
    } catch {
      return null;
    }
  }
  return { eventType, imageBytes: Math.max(0, buffer.length - 8) };
}

function logComfyUIBinaryPreview(label: string, info: ComfyUIBinaryPreviewInfo): void {
  const key = label;
  const frame = (previewFrameCounts.get(key) ?? 0) + 1;
  previewFrameCounts.set(key, frame);
  if (frame !== 1 && frame % 8 !== 0) return;
  const imageFormatLabel =
    info.imageFormat === 1 ? 'jpeg' : info.imageFormat === 2 ? 'png' : info.imageFormat !== undefined ? String(info.imageFormat) : undefined;
  logComfyUIWs('preview frame (generation in progress)', {
    label,
    frame,
    eventType: info.eventType,
    imageFormat: imageFormatLabel ?? null,
    imageBytes: info.imageBytes,
    node: info.meta?.node ?? null,
    promptId: info.meta?.prompt_id ?? null,
  });
}

function resetComfyUIBinaryPreviewCount(label: string): void {
  previewFrameCounts.delete(label);
}

function logComfyUIWs(message: string, details?: Record<string, unknown>): void {
  if (details && Object.keys(details).length > 0) {
    console.log(`[ComfyUI WS] ${message}`, details);
    return;
  }
  console.log(`[ComfyUI WS] ${message}`);
}

function parseComfyUIWsMessage(raw: WebSocket.Data, label: string): ComfyUIWsMessage | null {
  const jsonMsg = tryParseJsonWsMessage(raw);
  if (jsonMsg) return jsonMsg;
  if (typeof raw === 'string') {
    logComfyUIWs('malformed JSON message', { label, preview: raw.slice(0, 200) });
    return null;
  }
  const preview = parseComfyUIBinaryMessage(raw);
  if (preview) {
    logComfyUIBinaryPreview(label, preview);
    return null;
  }
  logComfyUIWs('binary message (unparsed)', { label, bytes: toBuffer(raw).length });
  return null;
}

function handleComfyUIWsMessage(msg: ComfyUIWsMessage, ctx: ComfyUIWsHandlerContext): ComfyUIWsHandlerResult {
  const msgType = msg.type ?? 'unknown';
  const data = msg.data ?? {};
  const promptId = data.prompt_id;
  const expectedPromptId = ctx.expectedPromptId;
  if (promptId && expectedPromptId && promptId !== expectedPromptId) {
    logComfyUIWs('message skipped (different prompt_id)', {
      label: ctx.label,
      type: msgType,
      promptId,
      expectedPromptId,
    });
    return { finished: false };
  }
  if (msgType === 'progress' || msgType === 'progress_state') {
    logComfyUIWs('progress', {
      label: ctx.label,
      type: msgType,
      promptId: promptId ?? null,
      node: data.node ?? null,
      value: data.value ?? null,
      max: data.max ?? null,
    });
    const progressNode = data.node ?? 'unknown';
    const progressValue = data.value ?? '?';
    const progressMax = data.max ?? '?';
    return {
      finished: false,
      progressMessage: `Progress on node ${progressNode} (${progressValue}/${progressMax})`,
    };
  }
  if (msgType === 'execution_start') {
    logComfyUIWs('execution started', { label: ctx.label, promptId: promptId ?? null });
    return { finished: false };
  }
  logComfyUIWs('message', {
    label: ctx.label,
    type: msgType,
    promptId: promptId ?? null,
    node: data.node ?? null,
    queueRemaining: data.status?.exec_info?.queue_remaining ?? null,
  });
  const isFinished =
    (msgType === 'executing' && promptId === expectedPromptId && (data.node === null || data.node === undefined)) ||
    (msgType === 'execution_success' && promptId === expectedPromptId);
  if (isFinished) {
    logComfyUIWs('job finished', { label: ctx.label, promptId, type: msgType });
    return { finished: true };
  }
  if (msgType === 'execution_error' && promptId === expectedPromptId) {
    const error = data.exception_message ?? 'Execution error';
    logComfyUIWs('execution error', { label: ctx.label, promptId, error });
    return { finished: true, error };
  }
  return { finished: false };
}

function countHistoryOutputs(history: ComfyUIHistoryEntry | null): number {
  if (!history?.outputs) return 0;
  return Object.values(history.outputs).reduce((count, nodeOutput) => {
    return count + (nodeOutput.images?.length ?? 0) + (nodeOutput.gifs?.length ?? 0) + (nodeOutput.videos?.length ?? 0);
  }, 0);
}

export class ComfyUIClient {
  private getBaseUrl(): string {
    return configManager.getComfyUIBaseUrl().replace(/\/+$/, '');
  }

  private apiUrl(path: string): string {
    return `${this.getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private wsUrl(clientId: string): string {
    const base = this.getBaseUrl().replace(/^http/, 'ws');
    return `${base}/ws?clientId=${encodeURIComponent(clientId)}`;
  }

  async healthCheck(): Promise<{ reachable: boolean; baseUrl: string; queuePending: number; queueRunning: number; details?: string }> {
    const baseUrl = this.getBaseUrl();
    try {
      const res = await fetch(this.apiUrl('/queue'), { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        return { reachable: false, baseUrl, queuePending: 0, queueRunning: 0, details: `Queue returned ${res.status}` };
      }
      const data = (await res.json()) as ComfyUIQueueStatus;
      return {
        reachable: true,
        baseUrl,
        queuePending: data.queue_pending?.length ?? 0,
        queueRunning: data.queue_running?.length ?? 0,
      };
    } catch (err: any) {
      return { reachable: false, baseUrl, queuePending: 0, queueRunning: 0, details: err.message };
    }
  }

  async submitPrompt(workflow: Record<string, unknown>, clientId?: string): Promise<ComfyUIPromptResponse> {
    const id = clientId ?? randomUUID();
    const res = await fetch(this.apiUrl('/prompt'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`ComfyUI /prompt failed (${res.status}): ${formatComfyUIErrorBody(body)}`);
    }
    if ((body as ComfyUIPromptResponse).node_errors && Object.keys((body as ComfyUIPromptResponse).node_errors!).length > 0) {
      throw new Error(`ComfyUI node errors: ${JSON.stringify((body as ComfyUIPromptResponse).node_errors)}`);
    }
    return body as ComfyUIPromptResponse;
  }

  async getHistory(promptId: string): Promise<ComfyUIHistoryEntry | null> {
    const res = await this.fetchJson(`/history/${encodeURIComponent(promptId)}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      if (res.status === 404) return this.findHistoryInFullList(promptId);
      throw new Error(`ComfyUI /history failed (${res.status})`);
    }
    const data = (await res.json()) as Record<string, ComfyUIHistoryEntry>;
    const entry = data[promptId] ?? null;
    if (entry) return entry;
    return this.findHistoryInFullList(promptId);
  }

  private async findHistoryInFullList(promptId: string): Promise<ComfyUIHistoryEntry | null> {
    const res = await this.fetchJson('/history', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, ComfyUIHistoryEntry>;
    return data[promptId] ?? null;
  }

  async submitPromptAndWait(
    workflow: Record<string, unknown>,
    options: WaitForCompletionOptions = {},
  ): Promise<{ promptId: string; history: ComfyUIHistoryEntry }> {
    const clientId = options.clientId ?? randomUUID();
    const timeoutMs = options.timeoutMs ?? configManager.getConfig().comfyui.requestTimeoutMs;
    const deadline = Date.now() + timeoutMs;
    const label = 'submitPromptAndWait';
    const promptRef: { id?: string } = {};
    let wsDone = false;
    let wsError: string | undefined;
    let resolveCompletion: (() => void) | undefined;

    const completionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
      setTimeout(resolve, timeoutMs);
    });

    const wsConnected = new Promise<void>((resolve) => {
      let ws: WebSocket | null = null;
      const wsUrl = this.wsUrl(clientId);
      logComfyUIWs('connecting', { label, clientId, url: wsUrl });
      const connectTimer = setTimeout(() => {
        logComfyUIWs('connect timeout (continuing with history poll)', { label, clientId });
        ws?.close();
        resolve();
      }, 5000);
      try {
        ws = new WebSocket(wsUrl);
        ws.on('open', () => {
          logComfyUIWs('connected', { label, clientId });
          clearTimeout(connectTimer);
          resolve();
        });
        ws.on('message', (raw) => {
          const msg = parseComfyUIWsMessage(raw, label);
          if (!msg) return;
          const result = handleComfyUIWsMessage(msg, {
            label,
            clientId,
            expectedPromptId: promptRef.id,
          });
          if (result.progressMessage && options.onProgress) {
            options.onProgress(result.progressMessage);
          }
          if (result.error) {
            wsError = result.error;
            ws?.close();
            resolveCompletion?.();
            return;
          }
          if (result.finished) {
            wsDone = true;
            const previewFrames = previewFrameCounts.get(label) ?? 0;
            if (previewFrames > 0) {
              logComfyUIWs('preview stream complete', { label, promptId: promptRef.id ?? null, previewFrames });
            }
            resetComfyUIBinaryPreviewCount(label);
            ws?.close();
            resolveCompletion?.();
          }
        });
        ws.on('error', (err) => {
          logComfyUIWs('socket error', { label, clientId, error: err.message });
          clearTimeout(connectTimer);
          resolve();
        });
        ws.on('close', (code, reason) => {
          logComfyUIWs('closed', { label, clientId, code, reason: reason.toString() });
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logComfyUIWs('connect failed', { label, clientId, error: errorMessage });
        clearTimeout(connectTimer);
        resolve();
      }
    });

    await wsConnected;
    resetComfyUIBinaryPreviewCount(label);
    const submitted = await this.submitPrompt(workflow, clientId);
    promptRef.id = submitted.prompt_id;
    logComfyUIWs('prompt submitted', { label, clientId, promptId: promptRef.id, queueNumber: submitted.number });
    await completionPromise;

    if (wsError) {
      throw new Error(wsError);
    }

    while (Date.now() < deadline) {
      const history = await this.getHistory(submitted.prompt_id);
      const outputCount = countHistoryOutputs(history);
      logComfyUIWs('history poll', {
        label: 'submitPromptAndWait',
        promptId: submitted.prompt_id,
        wsDone,
        outputCount,
        hasHistory: history !== null,
      });
      if (history?.outputs && Object.keys(history.outputs).length > 0) {
        logComfyUIWs('history ready', { label: 'submitPromptAndWait', promptId: submitted.prompt_id, outputCount });
        return { promptId: submitted.prompt_id, history };
      }
      if (wsDone && history) {
        logComfyUIWs('history returned after ws done', { label: 'submitPromptAndWait', promptId: submitted.prompt_id, outputCount });
        return { promptId: submitted.prompt_id, history };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    logComfyUIWs('job timed out', { label: 'submitPromptAndWait', promptId: submitted.prompt_id, wsDone, timeoutMs });
    throw new Error(`ComfyUI job timed out after ${timeoutMs}ms (prompt_id: ${submitted.prompt_id})`);
  }

  async waitForCompletion(promptId: string, options: WaitForCompletionOptions = {}): Promise<ComfyUIHistoryEntry> {
    const clientId = options.clientId ?? randomUUID();
    const timeoutMs = options.timeoutMs ?? configManager.getConfig().comfyui.requestTimeoutMs;
    const deadline = Date.now() + timeoutMs;
    let wsDone = false;
    let wsError: string | undefined;

    const wsPromise = new Promise<void>((resolve) => {
      let ws: WebSocket | null = null;
      const wsUrl = this.wsUrl(clientId);
      logComfyUIWs('connecting', { label: 'waitForCompletion', clientId, promptId, url: wsUrl });
      const timer = setTimeout(() => {
        logComfyUIWs('watch timeout (continuing with history poll)', { label: 'waitForCompletion', clientId, promptId, timeoutMs });
        ws?.close();
        resolve();
      }, timeoutMs);
      try {
        ws = new WebSocket(wsUrl);
        ws.on('open', () => {
          logComfyUIWs('connected', { label: 'waitForCompletion', clientId, promptId });
        });
        ws.on('message', (raw) => {
          const msg = parseComfyUIWsMessage(raw, 'waitForCompletion');
          if (!msg) return;
          const result = handleComfyUIWsMessage(msg, {
            label: 'waitForCompletion',
            clientId,
            expectedPromptId: promptId,
          });
          if (result.progressMessage && options.onProgress) {
            options.onProgress(result.progressMessage);
          }
          if (result.error) {
            wsError = result.error;
            clearTimeout(timer);
            ws?.close();
            resolve();
            return;
          }
          if (result.finished) {
            wsDone = true;
            clearTimeout(timer);
            ws?.close();
            resolve();
          }
        });
        ws.on('error', (err) => {
          logComfyUIWs('socket error', { label: 'waitForCompletion', clientId, promptId, error: err.message });
          clearTimeout(timer);
          resolve();
        });
        ws.on('close', (code, reason) => {
          logComfyUIWs('closed', { label: 'waitForCompletion', clientId, promptId, code, reason: reason.toString() });
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logComfyUIWs('connect failed', { label: 'waitForCompletion', clientId, promptId, error: errorMessage });
        clearTimeout(timer);
        resolve();
      }
    });

    await wsPromise;

    while (Date.now() < deadline) {
      if (wsError) {
        throw new Error(wsError);
      }
      const history = await this.getHistory(promptId);
      const outputCount = countHistoryOutputs(history);
      logComfyUIWs('history poll', {
        label: 'waitForCompletion',
        promptId,
        wsDone,
        outputCount,
        hasHistory: history !== null,
      });
      if (history?.outputs && Object.keys(history.outputs).length > 0) {
        logComfyUIWs('history ready', { label: 'waitForCompletion', promptId, outputCount });
        return history;
      }
      if (wsDone) {
        const finalHistory = await this.getHistory(promptId);
        const finalOutputCount = countHistoryOutputs(finalHistory);
        logComfyUIWs('history after ws done', { label: 'waitForCompletion', promptId, outputCount: finalOutputCount });
        if (finalHistory) return finalHistory;
        throw new Error('ComfyUI execution finished but no outputs found in history');
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    logComfyUIWs('job timed out', { label: 'waitForCompletion', promptId, wsDone, timeoutMs });
    throw new Error(`ComfyUI job timed out after ${timeoutMs}ms (prompt_id: ${promptId})`);
  }

  async downloadOutput(filename: string, subfolder = '', type = 'output'): Promise<Buffer> {
    const params = new URLSearchParams({ filename, subfolder, type });
    const res = await fetch(this.apiUrl(`/view?${params.toString()}`), {
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      throw new Error(`ComfyUI /view failed (${res.status}) for ${filename}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async fetchJson(path: string, init?: RequestInit): Promise<Response> {
    const primary = await fetch(this.apiUrl(path), init);
    if (primary.ok || !path.startsWith('/')) return primary;
    const altPath = path.startsWith('/api/') ? path.replace(/^\/api/, '') : `/api${path}`;
    return fetch(this.apiUrl(altPath), init);
  }

  async freeMemory(options: { unloadModels?: boolean; freeMemory?: boolean } = {}): Promise<void> {
    const unloadModels = options.unloadModels ?? true;
    const freeMemoryFlag = options.freeMemory ?? true;
    const res = await this.fetchJson('/free', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unload_models: unloadModels, free_memory: freeMemoryFlag }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (res?.ok) {
      console.log('[ComfyUI] Freed VRAM before local model load');
      return;
    }
    console.warn('[ComfyUI] VRAM free request failed (ComfyUI may be unreachable or busy)');
  }

  async listUserDataWorkflows(): Promise<string[]> {
    const res = await this.fetchJson('/userdata?dir=workflows', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      throw new Error(`ComfyUI userdata list failed (${res.status})`);
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      return data
        .map((item) => (typeof item === 'string' ? item : (item as { path?: string; name?: string }).path ?? (item as { name?: string }).name))
        .filter((name): name is string => typeof name === 'string' && name.endsWith('.json'));
    }
    return [];
  }

  async convertWorkflowToApi(workflow: unknown): Promise<unknown | null> {
    const paths = ['/workflow/convert', '/api/workflow/convert'];
    for (const path of paths) {
      try {
        const res = await this.fetchJson(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(workflow),
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok) return res.json();
      } catch {
        // try next path
      }
    }
    return null;
  }

  async getUserDataWorkflow(filename: string): Promise<unknown> {
    const safeName = filename.replace(/\\/g, '/').split('/').pop() ?? filename;
    const filePath = `workflows/${safeName}`;
    const res = await this.fetchJson(`/userdata/${encodeURIComponent(filePath)}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      throw new Error(`ComfyUI userdata file failed (${res.status}): ${safeName}`);
    }
    return res.json();
  }

  async uploadImage(buffer: Buffer, filename: string): Promise<{ name: string; subfolder: string; type: string }> {
    const formData = new FormData();
    formData.append('image', new Blob([new Uint8Array(buffer)]), filename);
    formData.append('overwrite', 'true');
    const res = await fetch(this.apiUrl('/upload/image'), {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      throw new Error(`ComfyUI /upload/image failed (${res.status})`);
    }
    return (await res.json()) as { name: string; subfolder: string; type: string };
  }
}

export const comfyUIClient = new ComfyUIClient();
