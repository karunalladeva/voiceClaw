export class TTSModule {
  private static ttsInstance: any = null;
  private static isInitializing = false;
  
  /**
   * Lazy load the KokoroTTS instance
   */
  private static async getInstance() {
    if (this.ttsInstance) return this.ttsInstance;
    if (this.isInitializing) {
      // Wait for initialization if already started
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.ttsInstance;
    }
    
    try {
      this.isInitializing = true;
      console.log('[TTS] Loading Kokoro-82M ONNX model. This might take a moment on first run...');
      
      // @ts-ignore
      const { KokoroTTS } = await import('kokoro-js');
      
      const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
      this.ttsInstance = await KokoroTTS.from_pretrained(model_id, {
        dtype: "q8", // 8-bit quantized for better performance
        device: "cpu", 
      });
      
      console.log('[TTS] Model loaded successfully.');
    } catch (error) {
      console.error('[TTS] Failed to load model:', error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
    
    return this.ttsInstance;
  }

  /**
   * Synthesize text to speech
   * @param text The text to synthesize
   * @param voice The voice ID to use (default: af_heart)
   * @returns Raw audio object/buffer or saves to disk temporarily
   */
  static async synthesize(text: string, voice: string = 'af_heart') {
    try {
      const tts = await this.getInstance();
      console.log(`[TTS] Synthesizing: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}" with voice: ${voice}`);
      
      const audio = await tts.generate(text, {
        voice: voice,
      });
      
      return audio;
    } catch (error) {
      console.error('[TTS] Synthesis failed:', error);
      throw error;
    }
  }
}