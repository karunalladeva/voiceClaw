import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { STTModule } from '../stt/whisper';
import { TTSSwitcher as TTSModule } from '../tts/index';
import { ReactAgent, StreamEvent } from '../agents/react-agent';
import { configManager } from '../config/index';
import { invalidateSearxngProbeCache, probeSearxngAvailability } from '../tools/searxng-client';
import { modelRegistry } from '../models/model-registry';
import { modelRouter } from '../models/model-router';
import { historyManager } from '../agents/agent-history';
import { startPipelineTicker } from '../pipeline/pipeline-engine';
import '../pipeline/steps'; // register step executors
import { vramMonitor } from '../utils/vram-monitor';
import { channelInputManager } from '../pipeline/channel-input-manager';
import { setSharedReactAgent } from '../agents/shared-agent';
import { deliverToChannel } from '../pipeline/channels';
import { evolutionService } from '../services/evolution-service';
import { evolutionScheduler } from '../services/evolution-scheduler';
import { setupAdminWebSocket, setupAdminRoutes } from '../admin/admin-server';
import { setupMicroRouterAdminRoutes } from '../admin/micro-router-routes';
import { agentEvents } from '../admin/agent-events';
import { setupOrchestrationRoutes } from '../orchestration/routes';
import { setupCreatorRoutes } from '../creator/routes';
import { setupComfyUIRoutes } from '../comfyui/routes';
import { setupSearxngRoutes } from '../searxng/routes';
import { setupLlamaCppRoutes } from '../llamacpp/routes';
import { comfyUIService } from '../services/comfyui-service';
import {
  orchestrationStore,
  heartbeatScheduler,
  agentRegistry,
  routineScheduler,
  taskManager,
} from '../orchestration';
import { logAgentRun } from '../orchestration/agent-run-logger';
import type { AgentRunMode } from '../orchestration/types';
import {
  capSpeechPlain,
  removeSpokenSummaryBlock,
  selectPlainTextForTts,
  SpokenSummaryDisplayFilter,
  splitIntoTtsChunks,
} from '../utils/speech-for-tts';
import { inferenceActivity } from '../utils/inference-activity';
import { isInferenceInterruptError } from '../utils/inference-interrupt';
import { modelLoadCoordinator } from '../models/model-load-coordinator';

vramMonitor.startMonitoring();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const agent = new ReactAgent();

// Global registry for Stop-and-Swap request interruption
const activeControllers = new Map<string, AbortController>();

/** Build one final string for TTS from raw model answer (minimal summary block or full body, then char cap). */
function buildFinalTtsText(rawAnswer: string): string {
  const speech = configManager.getConfig().speech;
  const plainSelected = selectPlainTextForTts(rawAnswer, speech);
  return capSpeechPlain(plainSelected, speech.fallbackMaxChars, speech.truncationSuffix);
}


app.use(cors());
app.use(express.json());

function sendSSE(res: express.Response, event: StreamEvent) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  if (typeof (res as any).flush === 'function') (res as any).flush();
}

/** Relay agent stream to client; hide <spoken_summary> from UI while keeping raw text for TTS. */
function relayAgentStreamEvent(
  res: express.Response,
  event: StreamEvent,
  displayFilter: SpokenSummaryDisplayFilter,
): string | undefined {
  if (event.type === 'token' && event.data) {
    const display = displayFilter.feed(String(event.data));
    if (display) sendSSE(res, { type: 'token', data: display });
    return undefined;
  }
  if (event.type === 'text_done' && event.data) {
    const raw = String(event.data);
    sendSSE(res, { type: 'text_done', data: removeSpokenSummaryBlock(raw) });
    return raw;
  }
  sendSSE(res, event);
  return undefined;
}

function initSSE(res: express.Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

/**
 * Synthesize text to a raw Buffer, bypassing the temp-file round-trip on read.
 * The temp file is written once and immediately deleted after reading.
 */
async function synthToBuffer(text: string): Promise<Buffer> {
  const voice = configManager.getConfig().tts.defaultVoice;
  const audio = await Promise.race([
    TTSModule.synthesize(text, voice),
    new Promise((_, reject) => setTimeout(() => reject(new Error('TTS Engine Timeout')), 15000))
  ]) as any;
  const tempFilePath = path.join(os.tmpdir(), `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  await audio.save(tempFilePath);
  const buffer = await fs.readFile(tempFilePath);
  await fs.unlink(tempFilePath).catch(() => { });
  return buffer;
}

/** Stream TTS in sentence chunks so the first audio clip starts sooner. */
async function emitTtsForAnswer(
  res: express.Response,
  rawAnswer: string,
  signal: AbortSignal,
): Promise<void> {
  const ttsText = buildFinalTtsText(rawAnswer);
  if (!ttsText.trim() || signal.aborted) return;
  const chunks = splitIntoTtsChunks(ttsText);
  sendSSE(res, { type: 'audio_start', data: String(chunks.length) });
  const ttsStart = Date.now();
  for (let i = 0; i < chunks.length; i++) {
    if (signal.aborted) return;
    const audioBuffer = await synthToBuffer(chunks[i]);
    if (signal.aborted) return;
    sendSSE(res, { type: 'audio', data: audioBuffer.toString('base64') });
    if (i === 0) {
      console.log(`[API] First TTS chunk ready in ${Date.now() - ttsStart}ms (${chunks[i].length} chars).`);
    }
  }
}

async function handleStreamingChat(
  req: express.Request,
  res: express.Response,
  input: string | any,
  chatId: string = 'default'
) {
  vramMonitor.registerActivity();
  initSSE(res);

  // IMMEDIATELY send a keepalive comment to verify the socket is working
  // before we start any heavy async work like model loading.
  // res.write(': active\n\n');
  sendSSE(res, { type: 'thinking', data: 'Thinking...' });
  if (typeof (res as any).flush === 'function') (res as any).flush();

  if (activeControllers.has(chatId)) {
    console.log(`[API] Aborting previous request for chat ${chatId}`);
    activeControllers.get(chatId)!.abort();
  }

  const controller = new AbortController();
  activeControllers.set(chatId, controller);

  res.on('close', () => {
    if (!controller.signal.aborted && !res.writableEnded) {
      console.log(`[API] Client disconnected (${chatId}) — aborting stream.`);
      controller.abort();
    }
    if (activeControllers.get(chatId) === controller) {
      activeControllers.delete(chatId);
    }
  });

  // Send a SSE comment heartbeat every 5s to keep the connection alive while
  // Ollama loads the model from disk (cold-start can take 15-30s).
  const keepalive = setInterval(() => {
    if (!controller.signal.aborted && !res.writableEnded) {
      res.write(': keepalive\n\n');
      if (typeof (res as any).flush === 'function') (res as any).flush();
    } else {
      clearInterval(keepalive);
    }
  }, 5000);

  let fullText = '';
  const displayFilter = new SpokenSummaryDisplayFilter();
  const releaseInference = inferenceActivity.begin();

  try {
    for await (const event of agent.processStream(input, chatId, controller.signal)) {
      if (controller.signal.aborted) break;

      const rawAnswer = relayAgentStreamEvent(res, event, displayFilter);
      if (rawAnswer) {
        fullText = rawAnswer;
        if (!controller.signal.aborted && configManager.getConfig().speech.finalOnly) {
          try {
            await emitTtsForAnswer(res, fullText, controller.signal);
          } catch (e) {
            console.error('[API] Final TTS failed:', e);
          }
        }
      }

      if (event.type === 'error') {
        fullText = event.data;
      }
    }
  } catch (err: any) {
    if (!controller.signal.aborted) {
      console.error('[API] Stream error:', err.message);
    }
  } finally {
    clearInterval(keepalive);
    releaseInference();
  }

  if (!res.writableEnded) {
    sendSSE(res, { type: 'done', data: '' });
    res.end();
  }

  if (activeControllers.get(chatId) === controller) {
    activeControllers.delete(chatId);
  }
}

// 0. Configuration API (Hot Reloading like OpenClaw)
app.get('/config', (req, res) => {
  res.json(configManager.getConfig());
});

app.post('/config', async (req, res) => {
  try {
    await configManager.updateConfig(req.body);
    res.json({ success: true, config: configManager.getConfig() });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update config', details: error.message });
  }
});

// 1. Listen -> Think -> Speak Loop via SSE Stream
app.post('/chat/audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const originalName = req.file.originalname;
    const chatId = req.body.chatId || 'default';
    const extension = originalName.includes('.')
      ? originalName.substring(originalName.lastIndexOf('.'))
      : '.wav';

    let textOrAudioPayload: string | any;
    const sttMode = configManager.getConfig().stt?.mode || 'transcribe';

    vramMonitor.registerActivity();
    initSSE(res);

    if (sttMode === 'direct') {
      const base64Audio = req.file.buffer.toString('base64');
      const mimeType = extension === '.wav' ? 'audio/wav' : 'audio/mpeg';
      textOrAudioPayload = [
        { type: "text", text: "Please listen to this audio and respond." },
        { type: "audio_url", audio_url: { url: `data:${mimeType};base64,${base64Audio}` } }
      ];
    } else {
      sendSSE(res, { type: 'thinking', data: 'Transcribing audio...' });
      textOrAudioPayload = await STTModule.transcribeBuffer(req.file.buffer, extension);
      sendSSE(res, { type: 'transcription', data: textOrAudioPayload });
    }

    if (activeControllers.has(chatId)) {
      console.log(`[API] Aborting previous audio request for chat ${chatId}`);
      activeControllers.get(chatId)!.abort();
    }

    const controller = new AbortController();
    activeControllers.set(chatId, controller);

    res.on('close', () => {
      if (!controller.signal.aborted && !res.writableEnded) {
        console.log(`[API] Client disconnected (${chatId}) — aborting audio stream.`);
        controller.abort();
      }
      if (activeControllers.get(chatId) === controller) {
        activeControllers.delete(chatId);
      }
    });

    let fullText = '';
    const displayFilter = new SpokenSummaryDisplayFilter();
    const releaseInference = inferenceActivity.begin();

    try {
      for await (const event of agent.processStream(textOrAudioPayload, chatId, controller.signal)) {
        if (controller.signal.aborted) break;

        const rawAnswer = relayAgentStreamEvent(res, event, displayFilter);
        if (rawAnswer) {
          fullText = rawAnswer;
          if (!controller.signal.aborted && configManager.getConfig().speech.finalOnly) {
            try {
              await emitTtsForAnswer(res, fullText, controller.signal);
            } catch (e) {
              console.error('[API] Final TTS failed:', e);
            }
          }
        }

        if (event.type === 'error') fullText = event.data;
      }
    } catch (err: any) {
      if (!controller.signal.aborted) {
        console.error('[API] Audio stream error:', err.message);
      }
    } finally {
      releaseInference();
    }

    if (!res.writableEnded) {
      sendSSE(res, { type: 'done', data: '' });
      res.end();
    }

    if (activeControllers.get(chatId) === controller) {
      activeControllers.delete(chatId);
    }

  } catch (error: any) {
    console.error('[API] Error in /chat/audio:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Chat processing failed', details: error.message });
    } else {
      sendSSE(res, { type: 'error', data: error.message });
      res.end();
    }
  }
});

// 1.5. Text -> Think -> Speak Loop via SSE Stream
app.post('/chat/text', async (req, res) => {
  try {
    const { text, chatId = 'default' } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text input is required' });
    }

    await handleStreamingChat(req, res, text, chatId);

  } catch (error: any) {
    console.error('[API] Error in /chat/text:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Text chat processing failed', details: error.message });
    }
  }
});

// 2. Just Listen (STT)
app.post('/listen', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }
    const extension = req.file.originalname.includes('.')
      ? req.file.originalname.substring(req.file.originalname.lastIndexOf('.'))
      : '.wav';
    const text = await STTModule.transcribeBuffer(req.file.buffer, extension);
    res.json({ text });
  } catch (error: any) {
    res.status(500).json({ error: 'Transcription failed', details: error.message });
  }
});

// 3. Just Speak (TTS)
app.post('/speak', async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Engine defaults to config inside TTSSwitcher
    const audio = await TTSModule.synthesize(text, voice);
    const tempFilePath = path.join(os.tmpdir(), `tts-${Date.now()}.wav`);
    await audio.save(tempFilePath);

    res.sendFile(tempFilePath, async (err) => {
      await fs.unlink(tempFilePath).catch(() => { });
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Synthesis failed', details: error.message });
  }
});

// 4. Onboarding Status (Check dependencies)
app.get('/onboard', async (req, res) => {
  const status = {
    workspace: false,
    ollama: false,
    llama3Model: false,
    details: [] as string[]
  };

  try {
    // Check workspace
    const workspacePath = path.join(process.cwd(), 'workspace');
    try {
      await fs.access(workspacePath);
      status.workspace = true;
      status.details.push('Workspace directory exists.');
    } catch {
      await fs.mkdir(workspacePath, { recursive: true });
      status.workspace = true;
      status.details.push('Workspace directory created.');
    }

    // Check Ollama
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (response.ok) {
        status.ollama = true;
        const data = await response.json() as { models?: Array<{ name: string }> };
        const hasLlama = data.models?.some(model => model.name.includes('llama3'));
        if (hasLlama) {
          status.llama3Model = true;
          status.details.push('Ollama is running and Llama3 model found.');
        } else {
          status.details.push('Ollama is running, but no Llama3 model was found.');
        }
      } else {
        status.details.push(`Ollama returned status: ${response.status}`);
      }
    } catch (err) {
      status.details.push('Could not connect to Ollama. Is it running?');
    }

    const comfyuiStatus = await comfyUIService.healthCheck();
    const comfyui = {
      enabled: comfyuiStatus.enabled,
      reachable: comfyuiStatus.reachable,
      details: comfyuiStatus.details ?? (comfyuiStatus.reachable ? 'ComfyUI server reachable.' : 'ComfyUI not reachable.'),
    };
    if (comfyui.enabled) {
      status.details.push(comfyui.details);
    }

    const isReady = status.workspace && status.ollama && status.llama3Model;

    res.json({
      ready: isReady,
      status: { ...status, comfyui },
    });

  } catch (error: any) {
    res.status(500).json({ error: 'Onboarding check failed', details: error.message });
  }
});

// 5. Skills API
app.get('/skills', (req, res) => {
  const registry = agent.getSkillRegistry();
  const skills = registry.getAllSkills().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    enabled: s.enabled,
    toolCount: s.tools.length,
  }));
  res.json({ skills });
});

// 5b. Learned Skills API (workspace/learned-skills SKILL.md files)
app.get('/skills/learned', async (req, res) => {
  try {
    const { learningEngine } = await import('../agents/learning-engine');
    const skills = await learningEngine.listLearnedSkills();
    res.json({
      skills: skills.map(s => {
        const stageMatch = s.content.match(/^stage:\s*(draft|validated|enabled)\s*$/m);
        return {
          name: s.name,
          description: s.description,
          content: s.content,
          stage: stageMatch?.[1] || 'draft',
        };
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/skills/learned/:name', async (req, res) => {
  try {
    const { learningEngine } = await import('../agents/learning-engine');
    const ok = await learningEngine.deleteLearnedSkill(req.params.name);
    if (ok) { res.json({ success: true }); }
    else { res.status(404).json({ error: 'Skill not found' }); }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/skills/learned/:name/promote', async (req, res) => {
  try {
    const { learningEngine } = await import('../agents/learning-engine');
    const stage = req.body?.stage === 'enabled' ? 'enabled' : 'validated';
    const ok = await learningEngine.promoteLearnedSkill(req.params.name, stage);
    if (!ok) return res.status(404).json({ error: 'Skill not found in promotable stage' });
    await agent.getSkillRegistry().loadLearnedSkills();
    res.json({ success: true, stage });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/skills/:id/enable', (req, res) => {
  const registry = agent.getSkillRegistry();
  if (registry.enableSkill(req.params.id)) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Skill not found' });
  }
});

app.post('/skills/:id/disable', (req, res) => {
  const registry = agent.getSkillRegistry();
  if (registry.disableSkill(req.params.id)) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Skill not found' });
  }
});

// ── Workspace Files API ──────────────────────────────────────────────────────
const WORKSPACE_INLINE_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

app.get('/workspace/download/*filePath', async (req, res) => {
  const workspacePath = path.join(process.cwd(), 'workspace');
  const rawPath = (req.params as { filePath?: string | string[] }).filePath;
  const relativePath = Array.isArray(rawPath) ? rawPath.join('/') : String(rawPath ?? '');
  if (!relativePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }
  const decodedPath = decodeURIComponent(relativePath);
  const filePath = path.resolve(workspacePath, decodedPath);
  if (!filePath.startsWith(workspacePath + path.sep)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  try {
    await fs.access(filePath);
    const forceDownload = req.query.download === '1' || req.query.download === 'true';
    const ext = path.extname(filePath).toLowerCase();
    const mime = WORKSPACE_INLINE_MIME[ext];
    if (!forceDownload && mime) {
      res.type(mime);
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
      res.sendFile(filePath);
      return;
    }
    res.download(filePath);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

app.get('/workspace/files', async (req, res) => {
  const workspacePath = path.join(process.cwd(), 'workspace');
  try {
    const entries = await fs.readdir(workspacePath, { withFileTypes: true });
    const categorized: Record<string, any[]> = { data: [], media: [], chats: [], skills: [], other: [] };

    for (const entry of entries) {
      const stat = await fs.stat(path.join(workspacePath, entry.name)).catch(() => null);
      const item = {
        name: entry.name,
        isDir: entry.isDirectory(),
        sizeBytes: stat?.size ?? 0,
        modifiedAt: stat?.mtime?.toISOString() ?? null,
      };
      if (entry.isDirectory()) {
        if (entry.name === 'chats') categorized.chats.push(item);
        else if (['learned', 'learned-skills', 'ondemand-skills'].includes(entry.name)) categorized.skills.push(item);
        else categorized.other.push(item);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.json') categorized.data.push(item);
        else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4'].includes(ext)) categorized.media.push(item);
        else categorized.other.push(item);
      }
    }
    res.json(categorized);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/workspace/files/:name', async (req, res) => {
  const workspacePath = path.join(process.cwd(), 'workspace');
  const filePath = path.join(workspacePath, req.params.name);
  if (!filePath.startsWith(workspacePath + path.sep)) return res.status(403).json({ error: 'Access denied' });
  try {
    await fs.unlink(filePath);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Session Management
app.get('/chats', async (req, res) => {

  try {
    const chats = await historyManager.listChats();
    res.json({ chats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/chats/:id', async (req, res) => {
  try {
    await historyManager.loadChat(req.params.id);
    const doc = historyManager.exportChatDoc(req.params.id);
    if (!doc) {
      res.json({ messages: [], summaries: [] });
      return;
    }
    res.json({
      messages: doc.messages,
      summaries: doc.summaries ?? [],
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/chats/:id', async (req, res) => {
  try {
    await historyManager.deleteChat(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function clearVisionCacheDir(): Promise<void> {
  try {
    const cacheDir = path.join(process.cwd(), 'workspace', 'cache');
    await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(cacheDir, { recursive: true }).catch(() => {});
  } catch {
    // non-critical
  }
}

app.post('/chats/clear', async (req, res) => {
  try {
    const body = req.body ?? {};
    const clearAll = body.all === true || body.scope === 'all';
    const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : '';
    if (clearAll) {
      const deleted = await agent.clearAllHistory();
      await clearVisionCacheDir();
      agentEvents.log('info', `[API] Cleared all chat history (${deleted} file(s)).`);
      res.json({
        success: true,
        deleted,
        message: `Cleared ${deleted} saved conversation(s), summaries, and caches.`,
      });
      return;
    }
    const targetId = chatId || 'default';
    await agent.clearHistory(targetId);
    await clearVisionCacheDir();
    agentEvents.log('info', `[API] Cleared chat history: ${targetId}`);
    res.json({ success: true, chatId: targetId, message: `Conversation "${targetId}" cleared.` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/chat/reset', async (req, res) => {
  try {
    const clearAll = req.body?.all === true;
    if (clearAll) {
      const deleted = await agent.clearAllHistory();
      await clearVisionCacheDir();
      res.json({ success: true, deleted, message: `Cleared ${deleted} conversation(s).` });
      return;
    }
    await agent.clearHistory(req.body?.chatId || 'default');
    await clearVisionCacheDir();
    res.json({ success: true, message: 'Conversation history and vision cache cleared.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/chat/history', (req, res) => {
  res.json({ turns: agent.getHistoryLength() });
});

// 7. Memory Management API
app.get('/memory/status', async (req, res) => {
  try {
    const available = await agent.getMcpManager().isMemoryAvailable();
    const enabled = configManager.getConfig().memory?.enabled ?? true;
    res.json({ available, enabled });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/memory', async (req, res) => {
  try {
    const memories = await agent.getMcpManager().listMemories();
    res.json({ memories });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list memories', details: err.message });
  }
});

app.post('/memory', async (req, res) => {
  try {
    const { content, tags } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const result = await agent.getMcpManager().addMemory(content, tags || []);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to store memory', details: err.message });
  }
});

app.delete('/memory/:id', async (req, res) => {
  try {
    await agent.getMcpManager().deleteMemory(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete memory', details: err.message });
  }
});

app.get('/health', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    uptimeSec: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round(mem.rss / (1024 * 1024)),
      heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
    },
  });
});

app.get('/metrics', (_req, res) => {
  res.json({
    agentEvents: agentEvents.getStats(),
    runtime: agent.getRuntimeMetrics(),
    mcp: agent.getMcpManager().getStats(),
  });
});

// 8. Multi-model Management API ──────────────────────────────────────────────

/** List all models with their capabilities. */
app.get('/models', (_req, res) => {
  res.json({ models: modelRegistry.getAll() });
});

/** Add or update a model configuration. */
app.post('/models', async (req, res) => {
  try {
    const config = req.body;
    if (!config?.id || !config?.provider || !config?.model) {
      return res.status(400).json({ error: 'id, provider and model are required.' });
    }
    // Default sensible fields if not provided
    config.enabled = config.enabled ?? true;
    config.isMaster = config.isMaster ?? false;
    config.name = config.name || `${config.provider}/${config.model}`;
    config.role = config.role || 'general';

    const saved = await modelRegistry.addOrUpdate(config);
    modelRouter.invalidate(config.id);
    res.json({ success: true, model: saved });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save model.', details: err.message });
  }
});

/** Delete a model by ID. */
app.delete('/models/:id', async (req, res) => {
  try {
    const ok = await modelRegistry.delete(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Model not found.' });
    modelRouter.invalidate(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Promote a model to master. */
app.post('/models/:id/master', async (req, res) => {
  try {
    const ok = await modelRegistry.setMaster(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Model not found or disabled.' });
    modelRouter.invalidate();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Trigger capability detection for a specific model. */
app.post('/models/:id/detect', async (req, res) => {
  try {
    const caps = await modelRegistry.detectAndSave(req.params.id);
    if (!caps) return res.status(404).json({ error: 'Model not found.' });
    modelRouter.invalidate(req.params.id);
    res.json({ success: true, capabilities: caps });
  } catch (err: any) {
    res.status(500).json({ error: 'Capability detection failed.', details: err.message });
  }
});

/** Re-detect capabilities for ALL stale models. */
app.post('/models/detect-all', async (_req, res) => {
  try {
    await modelRegistry.refreshStale();
    modelRouter.invalidate();
    res.json({ success: true, models: modelRegistry.getAll() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 8. Channels API ──────────────────────────────────────────────────────────

import { loadChannels, saveChannels, ChannelConfig, getSupportedChannels } from '../pipeline/channels';

app.get('/channels', async (_req, res) => {
  const channels = await loadChannels();
  const supported = getSupportedChannels();
  res.json({ channels, supported });
});

app.post('/channels', async (req, res) => {
  try {
    const { type, name, settings, enabled } = req.body;
    if (!type || !name) return res.status(400).json({ error: 'type and name required' });
    const channels = await loadChannels();
    const existing = channels.findIndex(c => c.type === type);
    const prev = existing >= 0 ? channels[existing] : null;
    const config: ChannelConfig = {
      type,
      name,
      settings: settings ?? prev?.settings ?? {},
      enabled: typeof enabled === 'boolean' ? enabled : (prev?.enabled ?? true),
    };
    if (existing >= 0) { channels[existing] = config; } else { channels.push(config); }
    await saveChannels(channels);
    if (config.enabled) {
      await channelInputManager.ensureChannelRunning(type).catch((e: Error) => {
        console.error(`[API] Failed to start channel ${type}:`, e.message);
      });
    } else {
      await channelInputManager.stopChannel(type).catch(() => undefined);
    }
    res.json({ success: true, channel: config });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/channels/:type/toggle', async (req, res) => {
  const channels = await loadChannels();
  const ch = channels.find(c => c.type === req.params.type);
  if (!ch) return res.status(404).json({ error: 'Channel not found' });
  ch.enabled = !ch.enabled;
  await saveChannels(channels);
  if (ch.enabled) {
    await channelInputManager.ensureChannelRunning(ch.type).catch((e: Error) => {
      console.error(`[API] Failed to start channel ${ch.type}:`, e.message);
    });
  } else {
    await channelInputManager.stopChannel(ch.type).catch(() => undefined);
  }
  res.json({ success: true, channel: ch });
});

app.delete('/channels/:type', async (req, res) => {
  const channels = await loadChannels();
  const filtered = channels.filter(c => c.type !== req.params.type);
  await saveChannels(filtered);
  res.json({ success: true });
});

app.get('/channels/status', (req, res) => {
  res.json({ channels: channelInputManager.getStatus() });
});

app.post('/channels/:type/start', async (req, res) => {
  try {
    const type = req.params.type;
    const restart = req.query.restart === '1' || req.query.restart === 'true';
    if (restart) {
      await channelInputManager.restartChannel(type);
    } else {
      await channelInputManager.ensureChannelRunning(type);
    }
    res.json({ success: true, listening: channelInputManager.isListening(type) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/channels/:type/stop', async (req, res) => {
  try {
    await channelInputManager.stopChannel(req.params.type);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/channels/test-message', async (req, res) => {
  try {
    const { channelType, recipientId, message } = req.body;
    if (!channelType || !message) {
      return res.status(400).json({ error: 'channelType and message required' });
    }
    const override: Record<string, string> = {};
    if (recipientId) {
      override.to_number = recipientId;
      override.channel_id = recipientId;
      override.chat_id = recipientId;
      override.to_email = recipientId;
    }
    const result = await deliverToChannel(
      channelType,
      message,
      Object.keys(override).length > 0 ? override : undefined
    );
    res.json({ success: result.startsWith('✅'), result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── 8.5 Pairing API ──────────────────────────────────────────────────────────

app.get('/channels/pairings/pending', (req, res) => {
  res.json({ pairings: channelInputManager.getPendingPairings() });
});

app.post('/channels/pairings/approve', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  const success = channelInputManager.approvePairing(code);
  res.json({ success });
});

app.post('/channels/pairings/reject', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  const success = channelInputManager.rejectPairing(code);
  res.json({ success });
});

app.post('/channels/pairings/revoke', async (req, res) => {
  const { channelType, senderId } = req.body;
  if (!channelType || !senderId) return res.status(400).json({ error: 'channelType and senderId required' });
  const config = configManager.getConfig();
  if (config.approved_senders && config.approved_senders[channelType]) {
    config.approved_senders[channelType] = config.approved_senders[channelType].filter(id => id !== senderId);
    await configManager.updateConfig({ approved_senders: config.approved_senders });
  }
  res.json({ success: true });
});

app.get('/channels/pairings/approved', (req, res) => {
  const config = configManager.getConfig();
  res.json({ approved: config.approved_senders || {} });
});

// ── 8.6 Webhook Endpoints for Inputs ──────────────────────────────────────────

app.get('/channels/whatsapp/status', (req, res) => {
  const qr = (global as any).__whatsappQR;
  const connected = (global as any).__whatsappConnected || false;
  res.json({
    qr: qr || null,
    connected,
    listening: channelInputManager.isListening('whatsapp'),
    phase: (global as any).__whatsappPhase || 'idle',
    error: (global as any).__whatsappError || null,
  });
});

app.post('/channels/whatsapp/reset', async (req, res) => {
  try {
    await channelInputManager.stopChannel('whatsapp');
    const authDir = path.join(process.cwd(), 'workspace', 'whatsapp_auth');
    
    // Give file locks time to be released by Baileys
    await new Promise(r => setTimeout(r, 1500));
    
    try {
      await fs.rm(authDir, { recursive: true, force: true });
    } catch(err) {
      console.log('[API] First attempt to remove whatsapp_auth failed, retrying...');
      await new Promise(r => setTimeout(r, 1500));
      await fs.rm(authDir, { recursive: true, force: true }).catch(console.error);
    }
    
    (global as any).__whatsappQR = null;
    (global as any).__whatsappConnected = false;
    (global as any).__whatsappError = null;
    (global as any).__whatsappPhase = 'starting';

    await channelInputManager.restartChannel('whatsapp');
    res.json({ success: true });
  } catch(e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/channels/slack/webhook', async (req, res) => {
  const onMsg = (global as any).__slackOnMessage;
  if (!onMsg) return res.status(503).send('Slack input disabled.');

  const { type, challenge, event } = req.body;
  if (type === 'url_verification') return res.json({ challenge });

  if (event?.type === 'message' && !event.bot_id) {
    onMsg({
      channelType: 'slack',
      senderId: event.channel,
      senderName: event.user || 'User',
      text: event.text,
      replyFn: async (text: string) => {
        await deliverToChannel('slack', text, { channel_id: event.channel });
      }
    });
  }
  res.status(200).send();
});


// ── 9. Pipelines API ─────────────────────────────────────────────────────────

import { loadPipelines as loadPipes, savePipelines as savePipes, loadHistory, runPipeline } from '../pipeline/pipeline-engine';

app.get('/pipelines', async (_req, res) => {
  const pipelines = await loadPipes();
  res.json({ pipelines });
});

app.delete('/pipelines/:id', async (req, res) => {
  const pipelines = await loadPipes();
  const filtered = pipelines.filter(p => p.id !== req.params.id);
  await savePipes(filtered);
  res.json({ success: true });
});

app.post('/pipelines/:id/run', async (req, res) => {
  const pipelines = await loadPipes();
  const p = pipelines.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Pipeline not found' });
  const { success, outputs } = await runPipeline(p);
  await savePipes(pipelines);
  res.json({ success, outputs: outputs.map(o => ({ success: o.success, output: o.output.substring(0, 500) })) });
});

app.put('/pipelines/:id/toggle', async (req, res) => {
  const pipelines = await loadPipes();
  const p = pipelines.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Pipeline not found' });
  p.enabled = !p.enabled;
  await savePipes(pipelines);
  res.json({ success: true, pipeline: p });
});

app.get('/pipelines/history', async (_req, res) => {
  const history = await loadHistory();
  res.json({ history });
});

// ── 10. Notifications API ────────────────────────────────────────────────────

import { loadNotifications, markNotificationsRead } from '../pipeline/channels';

app.get('/notifications', async (_req, res) => {
  const notifications = await loadNotifications();
  // Return only unread ones
  res.json({ notifications: notifications.filter(n => !n.read) });
});

app.post('/notifications/read', async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  await markNotificationsRead(ids);
  res.json({ success: true });
});

// ── 11. Evolution Pipeline API ───────────────────────────────────────────────

app.post('/evolution/harvest', async (_req, res) => {
  try {
    const result = await evolutionService.harvestWorkspace();
    res.json({ success: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/evolution/stats', async (_req, res) => {
  try {
    const stats = await evolutionService.getStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/evolution/queue', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const result = await evolutionService.getReviewQueue(page, limit);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/evolution/queue/:id/approve', async (req, res) => {
  try {
    const ok = await evolutionService.approveSample(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Sample not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/evolution/queue/:id/reject', async (req, res) => {
  try {
    const ok = await evolutionService.rejectSample(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Sample not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/evolution/queue/batch-approve', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
    const count = await evolutionService.approveBatch(ids);
    res.json({ success: true, approved: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/evolution/queue/batch-reject', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
    const count = await evolutionService.rejectBatch(ids);
    res.json({ success: true, rejected: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/evolution/train', async (_req, res) => {
  try {
    const run = await evolutionService.startTraining();
    res.json({ success: true, run });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/evolution/training-status', (_req, res) => {
  const status = evolutionService.getTrainingStatus();
  res.json({ training: status });
});

app.get('/evolution/vram', async (_req, res) => {
  try {
    const vram = await evolutionService.checkVRAMGuard();
    res.json(vram);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/evolution/models', async (_req, res) => {
  try {
    const models = await evolutionService.listEvolvedModels();
    res.json({ models });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/evolution/models/:version/activate', async (req, res) => {
  try {
    const ok = await evolutionService.activateEvolvedModel(req.params.version);
    if (!ok) return res.status(404).json({ error: 'Model version not found' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/evolution/models/rollback', async (_req, res) => {
  try {
    const ok = await evolutionService.rollbackToBase();
    if (!ok) return res.status(404).json({ error: 'No base model found to rollback to' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/evolution/reset', async (req, res) => {
  try {
    const keepVerified = req.query.keepVerified === 'true';
    await evolutionService.resetHarvest({ keepVerified });
    res.json({ success: true, keepVerified });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export const startServer = async (port: number = 3000) => {
  const fsServerPath = path.join(process.cwd(), "src", "mcp-servers", "tools", "filesystem.ts");
  const memoryServerPath = path.join(process.cwd(), "src", "mcp-servers", "memory", "index.ts");
  const marketServerPath = path.join(process.cwd(), "src", "mcp-servers", "market", "index.ts");
  const chromaServerPath = path.join(process.cwd(), "src", "mcp-servers", "chromadb", "index.ts");

  // Initialize local tools first
  await agent.initialize([fsServerPath, memoryServerPath, marketServerPath, chromaServerPath]);
  setSharedReactAgent(agent);
  const masterAtStartup = modelRegistry.getMaster();
  if (masterAtStartup) {
    modelLoadCoordinator.markResidentFromStartup(masterAtStartup);
  }

  const mcp = agent.getMcpManager();
  let optionalMcpServersAdded = false;

  // 1. [GitHub]
  if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    console.log('[API] Initializing GitHub MCP Server...');
    await mcp.connectLocalServer('github', '', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN }
    });
    optionalMcpServersAdded = true;
  }

  // 2. [Gmail]
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
    console.log('[API] Initializing Gmail MCP Server...');
    await mcp.connectLocalServer('gmail', '', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gmail'],
      env: {
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
        GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN
      }
    });
    optionalMcpServersAdded = true;
  }

  // 3. [Google Cloud / Products]
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    console.log('[API] Initializing Google Cloud MCP Server...');
    await mcp.connectLocalServer('google-cloud', '', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-google-cloud'],
      env: {
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET
      }
    });
    optionalMcpServersAdded = true;
  }

  if (optionalMcpServersAdded) {
    await agent.reloadToolkit();
  }

  // ── Start the channel input manager ────────────────────────────────────────
  channelInputManager.setAgent(agent);
  await channelInputManager.startAll();

  // ── Start the pipeline engine ticker ────────────────────────────────────────
  startPipelineTicker();

  // ── Start the evolution scheduler ────────────────────────────────────────────
  evolutionScheduler.start();

  // ── Setup Admin Dashboard Routes ────────────────────────────────────────────
  setupAdminRoutes(app);
  setupMicroRouterAdminRoutes(app, agent);

  // ── Setup Orchestration (Paperclip-style) ──────────────────────────────────
  await orchestrationStore.initialize();
  setupOrchestrationRoutes(app);
  setupCreatorRoutes(app);
  await comfyUIService.initialize();
  setupComfyUIRoutes(app);
  setupSearxngRoutes(app);
  setupLlamaCppRoutes(app);

  const syncComfyUISkillEnabled = (): void => {
    const registry = agent.getSkillRegistry();
    const enabled = configManager.getConfig().comfyui.enabled;
    if (enabled) registry.enableSkill('comfyui-creator');
    else registry.disableSkill('comfyui-creator');
  };
  const refreshSearxngProbe = (): void => {
    invalidateSearxngProbeCache();
    void probeSearxngAvailability(true);
  };
  configManager.on('configChanged', syncComfyUISkillEnabled);
  configManager.on('configChanged', refreshSearxngProbe);
  syncComfyUISkillEnabled();
  refreshSearxngProbe();

  const { registerCreatorSkillReload } = await import('../creator/creator-skill-bridge');
  registerCreatorSkillReload(() => agent.reloadCreatorWorkspaceSkills());

  heartbeatScheduler.setHandler(async (orgAgent, task, context, mode, runPrep) => {
    const { agentRegistry } = await import('../orchestration/agent-registry');
    const {
      formatTeamDelegationHint,
      buildOrgOrchestrationSystemAppend,
    } = await import('../orchestration/orchestration-delegation');
    const directReports = await agentRegistry.getDirectReports(orgAgent.id);
    const delegationHint = formatTeamDelegationHint(directReports);
    const orgSystemAppend = buildOrgOrchestrationSystemAppend(orgAgent, task, directReports);
    let prompt: string;
    if (mode === 'review' && task) {
      prompt =
        `${context}\n\nYou are reviewing a team member's submitted work. ` +
        `Respond with a JSON object in a fenced code block (\`\`\`json ... \`\`\`) using this schema:\n` +
        `{"decision":"approve_escalate|approve_release|rework|reassign|escalate_user|request_clarification",` +
        `"notes":"...","nextAssigneeId":"optional-agent-id",` +
        `"spawnTask":{"title":"","description":"","assigneeId":"","blockedBy":[]}}\n` +
        `Use approve_escalate if you are not at the top of the chain. ` +
        `Use approve_release only if you are the final approver.`;
    } else if (task) {
      const pendingQuestions =
        directReports.length > 0
          ? await taskManager.listSubtasksAwaitingParentAnswer(task.id)
          : [];
      const answerDutyHint =
        pendingQuestions.length > 0
          ? `\n\nURGENT: ${pendingQuestions.length} subtask question(s) need answers. Use list_pending_subtask_questions and reply_to_subtask_question for each. Do not complete the parent task until answered.\n`
          : '';
      prompt =
        `${context}${delegationHint}${answerDutyHint}\n\n` +
        `Work on the assigned task. If requirements are unclear, call ask_parent_manager once, then wait for the answer (do not call it again). ` +
        `If a sub-agent handoff is incomplete or structured output is invalid, do not delegate — use partial tool-trace data, a fallback skill, or ask the user. ` +
        `If this requires your team to execute next steps, ` +
        `you MUST call create_subtask for each direct report before finishing (do not only describe tasks in prose).`;
    } else {
      prompt = `${context}\n\nCheck for any work that needs to be done and report status.`;
    }
    const modelId = orgAgent.modelId ?? 'master';
    const runMode: AgentRunMode = task ? mode : 'idle';
    const startedAt = Date.now();
    const rootTaskId = task?.rootTaskId ?? task?.id;
    if (rootTaskId && task) {
      const { hasPipelineModeLabel } = await import('../orchestration/orchestration-labels');
      const root =
        task.rootTaskId && task.rootTaskId !== task.id
          ? await taskManager.getTaskById(rootTaskId)
          : task;
      if (root && hasPipelineModeLabel(root.labels)) {
        modelLoadCoordinator.pinPipeline(rootTaskId, modelId);
      }
    }
    const releaseModel = await modelLoadCoordinator.acquire(modelId);
    const releaseInference = inferenceActivity.begin();
    let output = '';
    let success = true;
    let runError: string | undefined;
    try {
      for await (const event of agent.processStream(prompt, `heartbeat-${orgAgent.id}`, undefined, {
        modelId,
        skillIds: orgAgent.skills?.length ? orgAgent.skills : undefined,
        orgAgentId: orgAgent.id,
        orgTaskId: task?.id,
        orgRootTaskId: task?.rootTaskId ?? task?.id,
        orgSystemAppend,
        allowedReadPaths: runPrep?.allowedReadPaths,
        isManagerRun: runPrep?.isManager,
        pipelineMode: runPrep?.pipelineMode,
        blockersOpen: runPrep?.blockersOpen,
        userDecisionBound: !!runPrep?.userDecision,
      })) {
        if (event.type === 'text_done') {
          output = event.data;
        }
        if (event.type === 'error') {
          throw new Error(event.data);
        }
      }
    } catch (err: unknown) {
      success = false;
      runError = err instanceof Error ? err.message : String(err);
      if (isInferenceInterruptError(err)) {
        console.warn(
          `[Orchestration] Heartbeat LLM interrupted (${orgAgent.name}): model handoff — will retry`,
        );
        return output;
      }
      console.error(`[Orchestration] Heartbeat LLM error (${orgAgent.name}):`, runError);
      throw err;
    } finally {
      releaseInference();
      await releaseModel();
      try {
        await logAgentRun({
          agent: orgAgent,
          task,
          mode: runMode,
          modelId,
          prompt,
          answer: output,
          success,
          error: runError,
          durationMs: Date.now() - startedAt,
        });
      } catch (logErr: unknown) {
        const msg = logErr instanceof Error ? logErr.message : String(logErr);
        console.warn(`[Orchestration] Failed to log agent run: ${msg}`);
      }
    }
    return output;
  });
  
  // Start heartbeat scheduler
  await heartbeatScheduler.start();
  
  // Start routine scheduler
  routineScheduler.start();
  
  // Check for monthly budget resets daily at midnight
  setInterval(() => agentRegistry.resetMonthlyBudgets(), 24 * 60 * 60 * 1000);
  
  console.log('[API] Orchestration system initialized');

  console.log('[API] Warming up TTS engine (avoids cold-start delay after replies)...');
  await TTSModule.warmUp();

  // ── Create HTTP Server and attach WebSocket ─────────────────────────────────
  const server = http.createServer(app);
  setupAdminWebSocket(server);

  server.listen(port, () => {
    console.log(`[API] Server is running on port ${port}`);
    console.log(`[API] Health check: http://localhost:${port}/health`);
    console.log(`[API] Admin Dashboard: http://localhost:${port}/admin`);
    agentEvents.log('info', `Server started on port ${port}`);
  });

  const { isPipeClosedError } = await import('../utils/pipe-errors');

  process.on('unhandledRejection', (reason: unknown) => {
    if (isPipeClosedError(reason)) return;
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error('[API] Unhandled rejection:', reason);
    agentEvents.log('error', `Unhandled rejection: ${msg}`);
  });

  process.on('uncaughtException', (error: unknown) => {
    if (isPipeClosedError(error)) return;
    console.error('[API] Uncaught exception:', error);
    agentEvents.log('error', `Uncaught exception: ${error instanceof Error ? error.message : String(error)}`);
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`[API] Received ${signal}. Shutting down gracefully...`);
    agentEvents.log('info', `Received ${signal}; graceful shutdown started.`);
    void agent.getMcpManager().disconnectAll().catch(() => {});
    server.close(() => {
      console.log('[API] HTTP server closed.');
      process.exit(0);
    });
    setTimeout(() => {
      console.warn('[API] Force exit after shutdown timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
};