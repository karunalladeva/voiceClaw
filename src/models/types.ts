// ── Provider identifiers ──────────────────────────────────────────────────────
export type ModelProvider =
  | 'ollama'      // Local Ollama (default)
  | 'lmstudio'    // Local LM Studio (OpenAI-compatible)
  | 'openai'      // OpenAI API
  | 'anthropic'   // Anthropic Claude
  | 'google'      // Google Gemini
  | 'mistral'     // Mistral AI
  | 'deepseek'    // DeepSeek API (OpenAI-compatible)
  | 'custom';     // Any OpenAI-compatible endpoint

// ── Roles determine how the agent selects a model ────────────────────────────
export type ModelRole =
  | 'master'      // Primary orchestration / conversation model (only one)
  | 'vision'      // Image / video understanding specialist
  | 'audio'       // Audio input specialist
  | 'code'        // Code generation & analysis specialist
  | 'reasoning'   // Deep reasoning / chain-of-thought specialist
  | 'fast'        // Low-latency model for short tasks (e.g. summarize)
  | 'embedding'   // Embedding / vector generation
  | 'general';    // General-purpose fallback

// ── Task types the router uses to pick the best model ────────────────────────
export type TaskType =
  | 'text'
  | 'vision'
  | 'audio'
  | 'video'
  | 'code'
  | 'reasoning'
  | 'function_calling'
  | 'embedding'
  | 'summarize';   // Short summary tasks — prefer fast model

// ── Detected / declared capabilities for a model ─────────────────────────────
export interface ModelCapabilities {
  text: boolean;
  vision: boolean;           // Accepts image input
  audio: boolean;            // Accepts audio input
  video: boolean;            // Accepts video input
  functionCalling: boolean;  // Tool use / JSON function calling
  code: boolean;             // Code generation
  reasoning: boolean;        // Extended chain-of-thought / thinking
  embedding: boolean;        // Returns vector embeddings
  longContext: boolean;      // Context window ≥ 100 k tokens
  contextWindow: number;     // Tokens (input)
  maxOutputTokens: number;   // Tokens (output)
}

// ── Auth options for API-backed providers ─────────────────────────────────────
export interface ModelAuth {
  apiKey?: string;
  bearer?: string;                           // Used when apiKey field is not standard
  customHeaders?: Record<string, string>;    // Any extra request headers
}

// ── Full model configuration (persisted in models-config.json) ────────────────
export interface ModelConfig {
  id: string;                          // Unique slug (e.g. "master", "gpt-4o-vision")
  name: string;                        // Human-readable label
  role: ModelRole | ModelRole[];       // One or more roles this model covers
  provider: ModelProvider;
  model: string;                       // Provider-specific model ID
  baseUrl?: string;                    // Override default endpoint
  auth?: ModelAuth;
  enabled: boolean;
  isMaster: boolean;                   // Exactly one model should be true
  capabilities?: ModelCapabilities;    // Filled in by capability detector
  capabilitiesDetectedAt?: string;     // ISO-8601 timestamp of last detection
  tags?: string[];                     // Free-form labels (e.g. ["local", "fast"])
  description?: string;
}

// ── Top-level structure of models-config.json ─────────────────────────────────
export interface ModelRegistryData {
  version: number;
  models: ModelConfig[];
  lastUpdated: string;
}
