import { STTModule } from './src/stt/whisper';
import { TTSSwitcher as TTSModule } from './src/tts/index';
import * as fs from 'fs';

async function test() {
  try {
    console.log("Testing STT load...");
    // Let's create a dummy buffer to transcribe
    const dummyBuffer = Buffer.from('RIFF$   WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00', 'ascii');
    // It'll probably fail to transcribe this dummy file, but it will load the model!
    try {
        await STTModule.transcribeBuffer(dummyBuffer);
    } catch(e) {
        console.log("STT failed on dummy data as expected, but model should be loaded:", (e as any).message);
    }
    
    console.log("Testing TTS...");
    const audio = await TTSModule.synthesize("Testing one two three");
    console.log("TTS done!");
  } catch (e) {
    console.error("Test failed", e);
  }
}

test();
