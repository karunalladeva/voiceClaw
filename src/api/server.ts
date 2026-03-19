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

app.use(cors());
app.use(express.json());

function sendSSE(res: express.Response, event: StreamEvent) {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

function initSSE(res: express.Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

async function handleStreamingChat(res: express.Response, input: string | any) {
  initSSE(res);

  let fullText = '';

  for await (const event of agent.processStream(input)) {
    sendSSE(res, event);

    if (event.type === 'text_done') {
      fullText = event.data;
    }
    if (event.type === 'error') {
      fullText = event.data;
    }
  }

  // Synthesize TTS from the complete text
  if (fullText) {
    try {
      sendSSE(res, { type: 'thinking', data: 'Generating audio...' });
      const audio = await TTSModule.synthesize(fullText);
      const tempFilePath = path.join(os.tmpdir(), `response-${Date.now()}.wav`);
      await audio.save(tempFilePath);
      const audioBuffer = await fs.readFile(tempFilePath);
      const base64Audio = audioBuffer.toString('base64');
      sendSSE(res, { type: 'audio', data: base64Audio });
      await fs.unlink(tempFilePath).catch(() => {});
    } catch (ttsError: any) {
      console.error('[API] TTS failed:', ttsError);
      sendSSE(res, { type: 'error', data: 'Audio synthesis failed.' });
    }
  }

  sendSSE(res, { type: 'done', data: '' });
  res.end();
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
    
    let fullText = '';

    for await (const event of agent.processStream(textOrAudioPayload)) {
      sendSSE(res, event);
      if (event.type === 'text_done') fullText = event.data;
      if (event.type === 'error') fullText = event.data;
    }

    if (fullText) {
      try {
        sendSSE(res, { type: 'thinking', data: 'Generating audio...' });
        const audio = await TTSModule.synthesize(fullText);
        const tempFilePath = path.join(os.tmpdir(), `response-${Date.now()}.wav`);
        await audio.save(tempFilePath);
        const audioBuffer = await fs.readFile(tempFilePath);
        sendSSE(res, { type: 'audio', data: audioBuffer.toString('base64') });
        await fs.unlink(tempFilePath).catch(() => {});
      } catch (ttsError: any) {
        console.error('[API] TTS failed:', ttsError);
        sendSSE(res, { type: 'error', data: 'Audio synthesis failed.' });
      }
    }

    sendSSE(res, { type: 'done', data: '' });
    res.end();

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

    await handleStreamingChat(res, text);

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