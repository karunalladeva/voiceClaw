import * as fs from 'fs/promises';
import * as path from 'path';
// @ts-ignore
import { pipeline } from '@huggingface/transformers';
// @ts-ignore
import { KokoroTTS } from 'kokoro-js';

async function checkOllama() {
  console.log('🔍 Checking Ollama connection...');
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json() as { models?: Array<{ name: string }> };
    
    // Check if a model like llama3.1 or llama3.2 is installed
    const hasLlama = data.models?.some(model => model.name.includes('llama3'));
    
    console.log('✅ Ollama is running.');
    if (hasLlama) {
      console.log('✅ Found a Llama3 model.');
    } else {
      console.warn('⚠️  Ollama is running, but no Llama3 model was found. You might need to run: ollama run llama3.1');
    }
  } catch (error) {
    console.error('❌ Could not connect to Ollama. Is the Ollama app running?');
    console.error('   Please download it from https://ollama.com and start it.');
  }
}

async function checkWorkspace() {
  console.log('\n🔍 Checking workspace directory...');
  const workspacePath = path.join(process.cwd(), 'workspace');
  try {
    await fs.access(workspacePath);
    console.log('✅ Workspace directory exists.');
  } catch {
    console.log('⚠️  Workspace directory not found. Creating it...');
    await fs.mkdir(workspacePath, { recursive: true });
    console.log('✅ Workspace directory created.');
  }
}

async function preloadModels() {
  console.log('\n🔍 Pre-loading AI Models (This may take a few minutes)...');
  
  try {
    console.log('➡️  Pre-loading Kokoro TTS ONNX model...');
    const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
    await KokoroTTS.from_pretrained(model_id, {
      dtype: "q8",
      device: "cpu", 
    });
    console.log('✅ Kokoro TTS model downloaded and cached successfully.');
  } catch (error) {
    console.error('❌ Failed to preload Kokoro TTS model:', error);
  }

  try {
    console.log('➡️  Pre-loading Whisper STT ONNX model...');
    await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en');
    console.log('✅ Whisper STT model downloaded and cached successfully.');
  } catch (error) {
    console.error('❌ Failed to preload Whisper STT model:', error);
  }
}

async function main() {
  console.log('=============================================');
  console.log('🚀 Welcome to Local Talking LLM Setup');
  console.log('=============================================\n');

  await checkWorkspace();
  console.log('---------------------------------------------');
  await checkOllama();
  console.log('---------------------------------------------');
  await preloadModels();
  
  console.log('\n=============================================');
  console.log('🎉 Setup Check Complete!');
  console.log('You can now start the server by running:');
  console.log('npm run dev');
  console.log('=============================================');
}

main().catch(console.error);