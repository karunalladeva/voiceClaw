import { HumanMessage } from '@langchain/core/messages';
import { ModelCapabilities, ModelConfig } from './types';
import { createProvider } from './provider-factory';

// ── Known capabilities for popular model families ─────────────────────────────
// Keys are lowercase substrings that match model names.  More specific keys
// should be listed before more general ones.
const KNOWN: Array<[string, Partial<ModelCapabilities>]> = [
  // OpenAI
  ['o3-mini',         { reasoning: true,  functionCalling: false, contextWindow: 200000, maxOutputTokens: 100000 }],
  ['o1-mini',         { reasoning: true,  functionCalling: false, contextWindow: 128000, maxOutputTokens: 65536  }],
  ['o1',              { reasoning: true,  functionCalling: false, contextWindow: 200000, maxOutputTokens: 100000 }],
  ['gpt-4o-mini',     { vision: true,     functionCalling: true,  contextWindow: 128000, maxOutputTokens: 16384  }],
  ['gpt-4o',          { vision: true, audio: true, functionCalling: true, contextWindow: 128000, maxOutputTokens: 16384 }],
  ['gpt-4-turbo',     { vision: true,     functionCalling: true,  contextWindow: 128000, maxOutputTokens: 4096   }],
  ['gpt-4',           {                   functionCalling: true,  contextWindow: 8192,   maxOutputTokens: 4096   }],
  ['gpt-3.5-turbo',   {                   functionCalling: true,  contextWindow: 16385,  maxOutputTokens: 4096   }],
  // Anthropic
  ['claude-3-5-sonnet', { vision: true, functionCalling: true, reasoning: true, contextWindow: 200000, maxOutputTokens: 8192 }],
  ['claude-3-5-haiku',  { vision: true, functionCalling: true, contextWindow: 200000, maxOutputTokens: 8192 }],
  ['claude-3-opus',     { vision: true, functionCalling: true, contextWindow: 200000, maxOutputTokens: 4096 }],
  ['claude-3-haiku',    { vision: true, functionCalling: true, contextWindow: 200000, maxOutputTokens: 4096 }],
  ['claude-3-sonnet',   { vision: true, functionCalling: true, contextWindow: 200000, maxOutputTokens: 4096 }],
  // Google
  ['gemini-2.5-pro',    { vision: true, audio: true, video: true, functionCalling: true, reasoning: true, contextWindow: 1048576, maxOutputTokens: 65536 }],
  ['gemini-2.0-flash',  { vision: true, audio: true, video: true, functionCalling: true, contextWindow: 1048576, maxOutputTokens: 8192 }],
  ['gemini-1.5-pro',    { vision: true, audio: true, video: true, functionCalling: true, contextWindow: 2097152, maxOutputTokens: 8192 }],
  ['gemini-1.5-flash',  { vision: true, audio: true, video: true, functionCalling: true, contextWindow: 1048576, maxOutputTokens: 8192 }],
  // Mistral
  ['pixtral',           { vision: true, functionCalling: true, contextWindow: 128000, maxOutputTokens: 4096 }],
  ['mistral-large',     {               functionCalling: true, contextWindow: 131072, maxOutputTokens: 4096 }],
  ['mistral-small',     {               functionCalling: true, contextWindow: 32768,  maxOutputTokens: 4096 }],
  ['codestral',         { code: true,  functionCalling: true, contextWindow: 32768,  maxOutputTokens: 4096 }],
  // DeepSeek
  ['deepseek-r1',       { reasoning: true, contextWindow: 65536, maxOutputTokens: 8192 }],
  ['deepseek-coder',    { code: true, functionCalling: true, contextWindow: 32000, maxOutputTokens: 4096 }],
  ['deepseek-chat',     { functionCalling: true, contextWindow: 65536, maxOutputTokens: 4096 }],
  // Popular Ollama / open-source families
  ['llava',             { vision: true, contextWindow: 4096, maxOutputTokens: 2048 }],
  ['minicpm-v',         { vision: true, contextWindow: 8192, maxOutputTokens: 2048 }],
  ['moondream',         { vision: true, contextWindow: 2048, maxOutputTokens: 1024 }],
  ['bakllava',          { vision: true, contextWindow: 4096, maxOutputTokens: 2048 }],
  ['qwq',               { reasoning: true, contextWindow: 32768, maxOutputTokens: 8192 }],
  ['deepseek-r1',       { reasoning: true, contextWindow: 65536, maxOutputTokens: 8192 }],
  ['codellama',         { code: true, contextWindow: 16384, maxOutputTokens: 4096 }],
  ['starcoder',         { code: true, contextWindow: 8192,  maxOutputTokens: 4096 }],
  ['embed',             { embedding: true, contextWindow: 8192, maxOutputTokens: 0 }],
  ['nomic-embed',       { embedding: true, contextWindow: 8192, maxOutputTokens: 0 }],
  ['mxbai-embed',       { embedding: true, contextWindow: 8192, maxOutputTokens: 0 }],
];

const DEFAULTS: ModelCapabilities = {
  text: true,
  vision: false,
  audio: false,
  video: false,
  functionCalling: false,
  code: true,
  reasoning: false,
  embedding: false,
  longContext: false,
  contextWindow: 4096,
  maxOutputTokens: 2048,
};

// ── Tiny 1×1 white PNG (base64) for vision probe ──────────────────────────────
const PROBE_IMAGE_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';

// ── Layer 1: known model lookup ───────────────────────────────────────────────
function matchKnown(modelName: string): Partial<ModelCapabilities> {
  const lower = modelName.toLowerCase();
  for (const [key, caps] of KNOWN) {
    if (lower.includes(key)) return caps;
  }
  return {};
}

// ── Layer 2: infer from model name tokens ────────────────────────────────────
function inferFromName(modelName: string): Partial<ModelCapabilities> {
  const lower = modelName.toLowerCase();
  const caps: Partial<ModelCapabilities> = {};
  if (/vision|vl\b|-v\b|llava|minicpm-v|moondream/.test(lower)) caps.vision = true;
  if (/audio/.test(lower)) caps.audio = true;
  if (/video/.test(lower)) caps.video = true;
  if (/code|coder|codellama|starcoder|deepseek-coder/.test(lower)) caps.code = true;
  if (/reason|think|r1\b|qwq|o1\b|o3\b/.test(lower)) caps.reasoning = true;
  if (/embed/.test(lower)) caps.embedding = true;
  if (/128k|200k|1m|2m/.test(lower)) { caps.longContext = true; caps.contextWindow = 128000; }
  return caps;
}

// ── Layer 3: live probing ─────────────────────────────────────────────────────
async function probe(config: ModelConfig): Promise<Partial<ModelCapabilities>> {
  const probed: Partial<ModelCapabilities> = {};
  let llm: any;
  try {
    llm = await createProvider(config);
  } catch (err: any) {
    console.warn(`[CapabilityDetector] Could not create provider for "${config.id}": ${err.message}`);
    return probed;
  }

  // Basic text
  try {
    await llm.invoke([new HumanMessage({ content: 'Reply with the single word: ok' })]);
    probed.text = true;
  } catch {
    probed.text = false;
    return probed; // Model unreachable; skip remaining probes
  }

  // Function calling
  try {
    const { z } = await import('zod');
    const { tool } = await import('@langchain/core/tools');
    const dummy = tool(async () => 'x', {
      name: 'noop',
      description: 'noop',
      schema: z.object({ q: z.string() }),
    });
    const bound = llm.bindTools([dummy]);
    await bound.invoke([new HumanMessage({ content: 'Say hi.' })]);
    probed.functionCalling = true;
  } catch {
    probed.functionCalling = false;
  }

  // Vision — send a 1×1 PNG
  try {
    await llm.invoke([
      new HumanMessage({
        content: [
          { type: 'text', text: 'What colour is this image? One word.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${PROBE_IMAGE_B64}` } },
        ],
      }),
    ]);
    probed.vision = true;
  } catch {
    probed.vision = false;
  }

  return probed;
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function detectCapabilities(config: ModelConfig): Promise<ModelCapabilities> {
  const caps: ModelCapabilities = { ...DEFAULTS };

  Object.assign(caps, matchKnown(config.model));
  Object.assign(caps, inferFromName(config.model));
  Object.assign(caps, await probe(config));

  if (caps.contextWindow >= 100_000) caps.longContext = true;

  return caps;
}

/** Return capabilities from the lookup table + name inference only (no live call). */
export function detectCapabilitiesOffline(config: ModelConfig): ModelCapabilities {
  const caps: ModelCapabilities = { ...DEFAULTS };
  Object.assign(caps, matchKnown(config.model));
  Object.assign(caps, inferFromName(config.model));
  if (caps.contextWindow >= 100_000) caps.longContext = true;
  return caps;
}
