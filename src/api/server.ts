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

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const agent = new ReactAgent();

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
    .replace(/#{1,6}\s+/g, '')           // ## headings
    .replace(/\*\*(.+?)\*\*/g, '$1')     // **bold**
    .replace(/\*(.+?)\*/g, '$1')         // *italic*
    .replace(/__(.+?)__/g, '$1')         // __bold__
    .replace(/_(.+?)_/g, '$1')           // _italic_
    .replace(/`{1,3}[^`]*`{1,3}/g, '')  // `inline code` / ```blocks```
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
  if (plain.length <= AUDIO_MAX_CHARS) return plain;
  console.log(`[API] Response is ${plain.length} chars — trimming for audio.`);
  const slice = plain.substring(0, AUDIO_MAX_CHARS);
  const lastBreak = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('.\n'),
  );
  return lastBreak > 80 ? slice.substring(0, lastBreak + 1).trim() : slice.trim();
}


app.use(cors());
app.use(express.json());

function sendSSE(res: express.Response, event: StreamEvent) {
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
  const audio = await TTSModule.synthesize(text);
  const tempFilePath = path.join(os.tmpdir(), `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  await audio.save(tempFilePath);
  const buffer = await fs.readFile(tempFilePath);
  await fs.unlink(tempFilePath).catch(() => {});
  return buffer;
}

async function handleStreamingChat(
  req: express.Request,
  res: express.Response,
  input: string | any,
) {
  initSSE(res);

  const controller = new AbortController();
  req.on('close', () => {
    if (!controller.signal.aborted) {
      console.log('[API] Client disconnected — aborting stream.');
      controller.abort();
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
  let ttsPromise: Promise<Buffer> | null = null;

  try {
    for await (const event of agent.processStream(input, controller.signal)) {
      clearInterval(keepalive); // Stop keepalive once real events start
      if (controller.signal.aborted) break;

      sendSSE(res, event);

      if (event.type === 'text_done' && event.data) {
        fullText = event.data;
        sendSSE(res, { type: 'thinking', data: 'Preparing high-quality summary for voice...' });
        
        // Start summarise-then-synthesise immediately — runs in parallel with
        // any remaining SSE housekeeping.
        const ttsText = fullText.length > 500 
          ? await agent.summarizeForAudio(input, fullText)
          : ttsTextFor(input, fullText);
          
        sendSSE(res, { type: 'thinking', data: 'Generating audio...' });
        ttsPromise = synthToBuffer(ttsText)
          .catch((err: any) => {
            console.error('[API] TTS pre-synthesis failed:', err);
            return null as any;
          });
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

  if (!controller.signal.aborted && ttsPromise) {
    try {
      const audioBuffer = await ttsPromise;
      if (audioBuffer) sendSSE(res, { type: 'audio', data: audioBuffer.toString('base64') });
    } catch (ttsError: any) {
      console.error('[API] TTS failed:', ttsError);
      if (!controller.signal.aborted) {
        sendSSE(res, { type: 'error', data: 'Audio synthesis failed.' });
      }
    }
  }

  if (!res.writableEnded) {
    sendSSE(res, { type: 'done', data: '' });
    res.end();
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
    const extension = originalName.includes('.') 
      ? originalName.substring(originalName.lastIndexOf('.'))
      : '.wav';

    let textOrAudioPayload: string | any;
    const sttMode = configManager.getConfig().stt?.mode || 'transcribe';
    
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
    
    const controller = new AbortController();
    req.on('close', () => {
      if (!controller.signal.aborted) {
        console.log('[API] Client disconnected — aborting audio stream.');
        controller.abort();
      }
    });

    let fullText = '';
    let ttsPromise: Promise<Buffer> | null = null;
    // For the summarization prompt we want the plain-text question, not raw
    // audio bytes.  When STT is in direct mode the transcription isn't available,
    // so we fall back to a generic label.
    const userQuestion =
      sttMode === 'direct' ? '[audio input]' : (textOrAudioPayload as string);

    try {
      for await (const event of agent.processStream(textOrAudioPayload, controller.signal)) {
        if (controller.signal.aborted) break;

        sendSSE(res, event);
        if (event.type === 'text_done' && event.data) {
          fullText = event.data;
          sendSSE(res, { type: 'thinking', data: 'Preparing high-quality summary for voice...' });
          
          const ttsText = fullText.length > 500
            ? await agent.summarizeForAudio(userQuestion, fullText)
            : ttsTextFor(userQuestion, fullText);

          sendSSE(res, { type: 'thinking', data: 'Generating audio...' });
          ttsPromise = synthToBuffer(ttsText)
            .catch((err: any) => {
              console.error('[API] TTS pre-synthesis failed:', err);
              return null as any;
            });
        }

        if (event.type === 'error') fullText = event.data;
      }
    } catch (err: any) {
      if (!controller.signal.aborted) {
        console.error('[API] Audio stream error:', err.message);
      }
    }

    if (!controller.signal.aborted && ttsPromise) {
      try {
        const audioBuffer = await ttsPromise;
        if (audioBuffer) sendSSE(res, { type: 'audio', data: audioBuffer.toString('base64') });
      } catch (ttsError: any) {
        console.error('[API] TTS failed:', ttsError);
        if (!controller.signal.aborted) {
          sendSSE(res, { type: 'error', data: 'Audio synthesis failed.' });
        }
      }
    }

    if (!res.writableEnded) {
      sendSSE(res, { type: 'done', data: '' });
      res.end();
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
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text input is required' });
    }

    await handleStreamingChat(req, res, text);

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
      await fs.unlink(tempFilePath).catch(() => {});
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

// 6. Session Management
app.post('/chat/reset', (req, res) => {
  agent.clearHistory();
  res.json({ success: true, message: 'Conversation history cleared.' });
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

export const startServer = async (port: number = 3000) => {
  const fsServerPath = path.join(process.cwd(), "src", "mcp-servers", "tools", "filesystem.ts");
  const memoryServerPath = path.join(process.cwd(), "src", "mcp-servers", "memory", "index.ts");
  
  await agent.initialize([fsServerPath, memoryServerPath]);

  app.listen(port, () => {
    console.log(`[API] Server is running on port ${port}`);
    console.log(`[API] Health check: http://localhost:${port}/health`);
  });
};