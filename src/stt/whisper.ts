import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export class STTModule {
  private static transcriber: any = null;
  private static isInitializing = false;

  private static async getTranscriber() {
    if (this.transcriber) return this.transcriber;
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.transcriber;
    }

    try {
      this.isInitializing = true;
      console.log('[STT] Loading Whisper ONNX model. This might take a moment on first run...');
      
      // Dynamic import to allow graceful initialization
      // @ts-ignore
      const { pipeline } = await import('@huggingface/transformers');
      this.transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en');
      
      console.log('[STT] Whisper ONNX model loaded successfully.');
    } catch (error) {
      console.error('[STT] Failed to initialize Whisper model:', error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
    return this.transcriber;
  }

  /**
   * Transcribes an audio file into text.
   * @param filePath The absolute path to the audio file
   * @returns The transcribed text string
   */
  static async transcribe(filePath: string): Promise<string> {
    try {
      console.log(`[STT] Transcribing file: ${filePath}`);
      const transcriber = await this.getTranscriber();
      
      // Read the file buffer
      const buffer = await fs.readFile(filePath);
      
      // Use wavefile to parse the WAV file
      // @ts-ignore
      const { WaveFile } = await import('wavefile');
      const wav = new WaveFile(buffer);
      
      // Convert to 16kHz, 32-bit float, mono (required by whisper model)
      wav.toBitDepth('32f');
      wav.toSampleRate(16000);
      let audioData = wav.getSamples();
      
      // Handle multi-channel audio by converting to mono
      if (Array.isArray(audioData)) {
          if (audioData.length > 1) {
              const SCALING_FACTOR = Math.sqrt(2);
              for (let i = 0; i < audioData[0].length; ++i) {
                  audioData[0][i] = SCALING_FACTOR * (audioData[0][i] + audioData[1][i]) / 2;
              }
          }
          audioData = audioData[0];
      }

      // Pass the float32 array to the transcriber
      const output = await transcriber(audioData as unknown as Float32Array);
      
      if (output && output.text) {
        return output.text.trim();
      } else if (Array.isArray(output)) {
        return output.map((t: any) => t.text).join(' ').trim();
      }
      return String(output);
    } catch (error) {
      console.error('[STT] Transcription failed:', error);
      throw new Error('Transcription failed');
    }
  }

  /**
   * Transcribes a raw audio buffer by temporarily saving it to disk.
   */
  static async transcribeBuffer(buffer: Buffer, fileExtension: string = '.wav'): Promise<string> {
    const tempDir = os.tmpdir();
    const tempFileName = `audio-${Date.now()}${fileExtension}`;
    const tempFilePath = path.join(tempDir, tempFileName);
    
    try {
      await fs.writeFile(tempFilePath, buffer);
      const text = await this.transcribe(tempFilePath);
      return text;
    } finally {
      // Clean up temp file
      await fs.unlink(tempFilePath).catch(() => {});
    }
  }
}
