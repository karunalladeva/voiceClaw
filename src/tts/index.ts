import { TTSModule as KokoroTTS } from './kokoro';
import { configManager } from '../config/index';

// In the future, we will import QwenTTS here

export type TTSEngine = 'kokoro' | 'qwen';

export class TTSSwitcher {
  static getPreferredEngine(): TTSEngine {
    return configManager.getConfig().tts.engine;
  }

  static async synthesize(text: string, voice?: string) {
    const engine = this.getPreferredEngine();
    const finalVoice = voice || configManager.getConfig().tts.defaultVoice;

    try {
      if (engine === 'kokoro') {
        return await this.synthesizeWithKokoro(text, finalVoice);
      } else if (engine === 'qwen') {
        return await this.synthesizeWithQwen(text, finalVoice);
      }
    } catch (error) {
      console.warn(`[TTS Switcher] Primary engine (${engine}) failed. Falling back to alternative.`);
      
      // Graceful Fallback
      try {
        if (engine === 'kokoro') {
          return await this.synthesizeWithQwen(text, finalVoice);
        } else {
          return await this.synthesizeWithKokoro(text, finalVoice);
        }
      } catch (fallbackError) {
        console.error('[TTS Switcher] Both TTS engines failed.');
        throw new Error('TTS Synthesis failed on all engines.');
      }
    }
  }

  private static async synthesizeWithKokoro(text: string, voice: string) {
    console.log('[TTS Switcher] Attempting synthesis with Kokoro-JS...');
    return await KokoroTTS.synthesize(text, voice);
  }

  private static async synthesizeWithQwen(text: string, voice: string) {
    console.log('[TTS Switcher] Attempting synthesis with Qwen-TTS...');
    
    const pythonApiUrl = process.env.QWEN_TTS_URL || 'http://localhost:8000/synthesize';
    
    try {
      const response = await fetch(pythonApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      });

      if (!response.ok) {
        throw new Error(`Python Qwen-TTS API returned ${response.status}`);
      }

      // Convert the response array buffer to a format Kokoro/API expects
      // The API endpoint normally expects a "save" function.
      // We will create a mock object that mimics what Kokoro returns so the server code doesn't break
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      return {
        save: async (filePath: string) => {
          const fs = await import('fs/promises');
          await fs.writeFile(filePath, buffer);
        }
      };
      
    } catch (error: any) {
      console.error(`[TTS Switcher] Qwen-TTS failed: ${error.message}`);
      throw error; // Let the fallback mechanism catch this
    }
  }
}