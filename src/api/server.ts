import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { STTModule } from '../stt/whisper';
import { TTSSwitcher as TTSModule } from '../tts/index';
import { ReactAgent, StreamEvent } from '../agents/react-agent';
import { configManager } from '../config/index';
import { modelRegistry } from '../models/model-registry';
import { modelRouter } from '../models/model-router';
import { historyManager } from '../agents/agent-history';
import { startPipelineTicker } from '../pipeline/pipeline-engine';
import '../pipeline/steps'; // register step executors
import { vramMonitor } from '../utils/vram-monitor';
import { channelInputManager } from '../pipeline/channel-input-manager';
import { deliverToChannel } from '../pipeline/channels';
import { evolutionService } from '../services/evolution-service';
import { evolutionScheduler } from '../services/evolution-scheduler';


vramMonitor.startMonitoring();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const agent = new ReactAgent();

// Global registry for Stop-and-Swap request interruption
const activeControllers = new Map<string, AbortController>();

/**
 * Max characters spoken aloud. Responses beyond this are trimmed to the
 * nearest sentence boundary — no LLM call needed, so TTS starts instantly.
 * The full text is still sent to the client for display.
 */
const AUDIO_MAX_CHARS = 500;

/**
 * Returns the text that should be spoken aloud.
 * Trims long responses to the nearest sentence end within AUDIO_MAX_CHARS.
 * This is instant — avoids a second LLM round-trip before TTS.
/**
 * Strip markdown syntax so TTS reads clean natural text.
 * Handles: headers, bold, italic, code, bullets, links, horizontal rules.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' [Code provided on screen.] ') // Replace code blocks with spoken placeholder
    .replace(/`([^`]+)`/g, '$1')         // Remove inline backticks but keep the text
    .replace(/#{1,6}\s+/g, '')           // ## headings
    .replace(/\*\*(.+?)\*\*/g, '$1')     // **bold**
    .replace(/\*(.+?)\*/g, '$1')         // *italic*
    .replace(/__(.+?)__/g, '$1')         // __bold__
    .replace(/_(.+?)_/g, '$1')           // _italic_
    .replace(/!\[.*?\]\(.*?\)/g, '')     // images
    .replace(/\[(.+?)\]\(.*?\)/g, '$1') // [link text](url) → just the text
    .replace(/^[-*+]\s+/gm, '')         // bullet points
    .replace(/^\d+\.\s+/gm, '')         // numbered lists
    .replace(/^-{3,}$/gm, '')           // horizontal rules ---
    .replace(/>{1,}\s?/g, '')           // blockquotes >
    .replace(/\s{2,}/g, ' ')            // collapse extra spaces
    .trim();
}

function ttsTextFor(_userInput: string | any, fullText: string): string {
  const plain = stripMarkdown(fullText);
  if (plain.length === 0) {
    return "I've displayed the information on your screen.";
  }
  if (plain.length <= AUDIO_MAX_CHARS) return plain;
  
  console.log(`[API] Response is ${plain.length} chars — trimming for audio.`);
  const slice = plain.substring(0, AUDIO_MAX_CHARS);
  const lastBreak = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('.\n'),
  );
  
  const truncated = lastBreak > 80 ? slice.substring(0, lastBreak + 1).trim() : slice.trim();
  // Append a spoken indicator so the user knows there is more on screen.
  return `${truncated} I've placed the rest of the details on your screen.`;
}


app.use(cors());
app.use(express.json());

function sendSSE(res: express.Response, event: StreamEvent) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  if (typeof (res as any).flush === 'function') (res as any).flush();
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
  const audio = await Promise.race([
    TTSModule.synthesize(text),
    new Promise((_, reject) => setTimeout(() => reject(new Error('TTS Engine Timeout')), 15000))
  ]) as any;
  const tempFilePath = path.join(os.tmpdir(), `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  await audio.save(tempFilePath);
  const buffer = await fs.readFile(tempFilePath);
  await fs.unlink(tempFilePath).catch(() => { });
  return buffer;
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
  let sentenceBuffer = '';
  let ttsQueue = Promise.resolve();
  let ttsEpoch = 0;

  try {
    for await (const event of agent.processStream(input, chatId, controller.signal)) {
      clearInterval(keepalive); // Stop keepalive once real events start
      if (controller.signal.aborted) break;

      sendSSE(res, event);

      if (event.type === 'tool_call') {
        sentenceBuffer = ''; // Discard pre-tool conversational filler
        ttsEpoch++;          // Invalidate queued TTS tasks for the preamble
      }

      if (event.type === 'token') {
        sentenceBuffer += event.data;
        const match = sentenceBuffer.match(/([.!?]\s+|\n+)/);
        if (match) {
          const splitIndex = match.index! + match[0].length;
          const chunk = sentenceBuffer.substring(0, splitIndex);
          sentenceBuffer = sentenceBuffer.substring(splitIndex);

          const ttsText = ttsTextFor(input, chunk);
          if (ttsText.trim().length > 0) {
            const currentEpoch = ttsEpoch;
            ttsQueue = ttsQueue.then(async () => {
              if (controller.signal.aborted || currentEpoch !== ttsEpoch) return;
              try {
                sendSSE(res, { type: 'thinking', data: 'Generating audio stream...' });
                const audioBuffer = await synthToBuffer(ttsText);
                if (audioBuffer && !controller.signal.aborted && currentEpoch === ttsEpoch) {
                  sendSSE(res, { type: 'audio', data: audioBuffer.toString('base64') });
                }
              } catch (e) { console.error('[API] TTS chunk failed:', e); }
            });
          }
        }
      }

      if (event.type === 'text_done' && event.data) {
        fullText = event.data;
        if (sentenceBuffer.trim().length > 0) {
          const ttsText = ttsTextFor(input, sentenceBuffer);
          if (ttsText.trim().length > 0) {
            const currentEpoch = ttsEpoch;
            ttsQueue = ttsQueue.then(async () => {
              if (controller.signal.aborted || currentEpoch !== ttsEpoch) return;
              try {
                sendSSE(res, { type: 'thinking', data: 'Generating final audio...' });
                const audioBuffer = await synthToBuffer(ttsText);
                if (audioBuffer && !controller.signal.aborted && currentEpoch === ttsEpoch) {
                  sendSSE(res, { type: 'audio', data: audioBuffer.toString('base64') });
                }
              } catch (e) { console.error('[API] TTS chunk failed:', e); }
            });
          }
        }
        await ttsQueue; // Wait for all chunks to finish playing
      }

      if (event.type === 'error') {
        fullText = event.data;
      }
    }
  } catch (err: any) {
    if (!controller.signal.aborted) {
      console.error('[API] Stream error:', err.message);
    }
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
    let sentenceBuffer = '';
    let ttsQueue = Promise.resolve();

    // For the summarization prompt we want the plain-text question, not raw
    // audio bytes.  When STT is in direct mode the transcription isn't available,
    // so we fall back to a generic label.
    const userQuestion =
      sttMode === 'direct' ? '[audio input]' : (textOrAudioPayload as string);

    try {
      for await (const event of agent.processStream(textOrAudioPayload, chatId, controller.signal)) {
        if (controller.signal.aborted) break;

        sendSSE(res, event);

        if (event.type === 'token') {
          sentenceBuffer += event.data;
          const match = sentenceBuffer.match(/([.!?]\s+|\n+)/);
          if (match) {
            const splitIndex = match.index! + match[0].length;
            const chunk = sentenceBuffer.substring(0, splitIndex);
            sentenceBuffer = sentenceBuffer.substring(splitIndex);

            const ttsText = ttsTextFor(userQuestion, chunk);
            if (ttsText.trim().length > 0) {
              ttsQueue = ttsQueue.then(async () => {
                if (controller.signal.aborted) return;
                try {
                  sendSSE(res, { type: 'thinking', data: 'Generating audio stream...' });
                  const audioBuffer = await synthToBuffer(ttsText);
                  if (audioBuffer && !controller.signal.aborted) {
                    sendSSE(res, { type: 'audio', data: audioBuffer.toString('base64') });
                  }
                } catch (e) { console.error('[API] TTS chunk failed:', e); }
              });
            }
          }
        }

        if (event.type === 'text_done' && event.data) {
          fullText = event.data;
          if (sentenceBuffer.trim().length > 0) {
            const ttsText = ttsTextFor(userQuestion, sentenceBuffer);
            if (ttsText.trim().length > 0) {
              ttsQueue = ttsQueue.then(async () => {
                if (controller.signal.aborted) return;
                try {
                  sendSSE(res, { type: 'thinking', data: 'Generating final audio...' });
                  const audioBuffer = await synthToBuffer(ttsText);
                  if (audioBuffer && !controller.signal.aborted) {
                    sendSSE(res, { type: 'audio', data: audioBuffer.toString('base64') });
                  }
                } catch (e) { console.error('[API] TTS chunk failed:', e); }
              });
            }
          }
          await ttsQueue; // Wait for all chunks to finish
        }

        if (event.type === 'error') fullText = event.data;
      }
    } catch (err: any) {
      if (!controller.signal.aborted) {
        console.error('[API] Audio stream error:', err.message);
      }
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

    const isReady = status.workspace && status.ollama && status.llama3Model;

    res.json({
      ready: isReady,
      status
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
    res.json({ skills: skills.map(s => ({ name: s.name, description: s.description, content: s.content })) });
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
    const thread = await historyManager.loadChat(req.params.id);
    const messages = thread.map(m => ({
      role: m.getType() === 'human' ? 'user' : m.getType() === 'system' ? 'system' : 'agent',
      content: m.content.toString()
    }));
    res.json({ messages });
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

app.post('/chat/reset', async (req, res) => {
  await agent.clearHistory();
  try {
    const cacheDir = path.join(process.cwd(), 'workspace', 'cache');
    await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => { });
    await fs.mkdir(cacheDir, { recursive: true }).catch(() => { });
  } catch (e) { }
  res.json({ success: true, message: 'Conversation history and vision cache cleared.' });
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
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
    const { type, name, settings } = req.body;
    if (!type || !name) return res.status(400).json({ error: 'type and name required' });
    const channels = await loadChannels();
    const existing = channels.findIndex(c => c.type === type);
    const config: ChannelConfig = { type, name, settings: settings || {}, enabled: true };
    if (existing >= 0) { channels[existing] = config; } else { channels.push(config); }
    await saveChannels(channels);
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
    await channelInputManager.startChannel(req.params.type);
    res.json({ success: true });
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
    if (!channelType || !recipientId || !message) {
      return res.status(400).json({ error: 'channelType, recipientId, and message required' });
    }
    const result = await deliverToChannel(channelType, message, { to_number: recipientId, channel_id: recipientId, chat_id: recipientId });
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
  res.json({ qr: qr || null, connected });
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
    
    await channelInputManager.startChannel('whatsapp');
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

  // Initialize local tools first
  await agent.initialize([fsServerPath, memoryServerPath]);

  const mcp = agent.getMcpManager();

  // 1. [GitHub]
  if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    console.log('[API] Initializing GitHub MCP Server...');
    await mcp.connectLocalServer('github', '', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN }
    });
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
  }

  // Re-load tools to include newly connected servers
  await mcp.loadTools();

  // ── Start the channel input manager ────────────────────────────────────────
  channelInputManager.setAgent(agent);
  await channelInputManager.startAll();

  // ── Start the pipeline engine ticker ────────────────────────────────────────
  startPipelineTicker();

  // ── Start the evolution scheduler ────────────────────────────────────────────
  evolutionScheduler.start();


  app.listen(port, () => {
    console.log(`[API] Server is running on port ${port}`);
    console.log(`[API] Health check: http://localhost:${port}/health`);
  });
};