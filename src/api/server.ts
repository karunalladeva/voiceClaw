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

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const agent = new ReactAgent();

/**
 * Responses longer than this many characters get summarized before TTS.
 * The full text is still sent to the client for display.
 */
const AUDIO_SUMMARY_THRESHOLD = 400;

app.use(cors());
app.use(express.json());

function sendSSE(res: express.Response, event: StreamEvent) {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  // Flush immediately so the client receives each event without buffering delay
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
 * Returns the text that should be spoken aloud.
 * When the full response exceeds AUDIO_SUMMARY_THRESHOLD characters the LLM
 * produces a short, question-focused summary; otherwise the full text is used.
 */
async function ttsTextFor(userInput: string | any, fullText: string): Promise<string> {
  if (fullText.length <= AUDIO_SUMMARY_THRESHOLD) return fullText;
  console.log(`[API] Response is ${fullText.length} chars — summarizing for audio.`);
  return agent.summarizeForAudio(userInput, fullText);
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

  let fullText = '';
  let ttsPromise: Promise<Buffer> | null = null;

  try {
    for await (const event of agent.processStream(input, controller.signal)) {
      if (controller.signal.aborted) break;

      sendSSE(res, event);

      if (event.type === 'text_done' && event.data) {
        fullText = event.data;
        // Start summarise-then-synthesise immediately — runs in parallel with
        // any remaining SSE housekeeping.
        sendSSE(res, { type: 'thinking', data: 'Generating audio...' });
        ttsPromise = ttsTextFor(input, fullText)
          .then((ttsText) => synthToBuffer(ttsText))
          .catch((err) => {
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
          sendSSE(res, { type: 'thinking', data: 'Generating audio...' });
          ttsPromise = ttsTextFor(userQuestion, fullText)
            .then((ttsText) => synthToBuffer(ttsText))
            .catch((err) => {
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

export const startServer = async (port: number = 3000) => {
  const fsServerPath = path.join(process.cwd(), "src", "mcp-servers", "tools", "filesystem.ts");
  const memoryServerPath = path.join(process.cwd(), "src", "mcp-servers", "memory", "index.ts");
  
  await agent.initialize([fsServerPath, memoryServerPath]);

  app.listen(port, () => {
    console.log(`[API] Server is running on port ${port}`);
    console.log(`[API] Health check: http://localhost:${port}/health`);
  });
};