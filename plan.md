# Node.js Local Talking LLM Plan

This plan outlines the architecture and steps to build a local voice assistant similar to `local-talking-llm`, but centered around Node.js. It features a modular Text-to-Speech (TTS) system allowing you to switch between lightning-fast native Node.js TTS (Kokoro) and high-quality voice cloning (Qwen-TTS via Python).

## 📁 Plug-and-Play Folder Structure

To ensure the system is highly modular and extensible, we will use a strict plug-and-play Model Context Protocol (MCP) folder architecture:

- `src/agents/`: The ReAct Agent logic loops that act as the central "brain" and the **MCP Client**.
- `src/mcp-servers/`:
  - `memory/`: An MCP Server that exposes tools/resources for conversation history, context windows, and persistent state (Local JSON, MongoDB, or Vector DB).
  - `skills/`: MCP Servers that bundle high-level capabilities (e.g., `web-researcher/`).
  - `tools/`: MCP Servers that expose low-level, single-purpose functions (e.g., `duckduckgo-search`, `read-file`, `write-file`).
- `src/stt/` & `src/tts/`: Wrappers for different hearing and speaking engines, making it easy to swap Kokoro for Qwen.

1. **Hearing (STT):** `whisper-node` (Node.js bindings for whisper.cpp) + microphone recording.
    *   *Note: Audio input can optionally come from an external API endpoint instead of the local microphone.*
2. **Thinking (MCP ReAct Agent):** `ollama` combined with an MCP Client. The agent discovers available tools dynamically from the connected MCP Servers (Memory, Search, Files) and orchestrates the think loop.
3. **Speaking (TTS Switcher):**
  - *Mode 1 (Native Speed):* `kokoro-js` running directly inside the Node.js process using ONNX.
  - *Mode 2 (Max Quality/Cloning):* A lightweight Python FastAPI server running Qwen-TTS that the Node.js app calls via HTTP.

## 🛠️ Multi-Phase Implementation Roadmap

To ensure stable development, we will build this in 4 distinct phases. Each phase will include specific fallback mechanisms so the app doesn't crash if a component fails (e.g., no internet, or Ollama is down).

### Phase 1: The Core Loop (MVP)
*Goal: Get the app listening, thinking (without tools), and speaking using native Node.js libraries.*
1. **Initialize Project:** Setup `npm`, install `whisper-node`, `kokoro-js`, `ollama`, `express` (for API audio ingestion), and audio recording/playback libs.
2. **STT Module:** Implement microphone recording and `whisper-node` transcription. Also expose an API endpoint (`POST /listen`) so audio can come from external sources.
  - *Graceful Failure:* If microphone is blocked, fallback to CLI text input. If Whisper fails, alert user via console.
3. **Basic LLM Module:** Connect to the local Ollama daemon to stream a basic chat response (no MCP yet).
  - *Graceful Failure:* Check if Ollama daemon is running on startup. If not, trigger a spoken TTS error: "I cannot connect to my brain. Please start Ollama."
4. **TTS Module:** Implement native `kokoro-js` synthesis.
5. **App Loop:** Wire STT -> LLM -> TTS.

### Phase 2: The ReAct Agent & MCP Tooling (The Brain)
*Goal: Upgrade the LLM to an MCP-based ReAct Agent that can use external tools.*
1. **Tool MCP Server:** Build `src/mcp-servers/tools/` exposing DuckDuckGo Search and File System tools.
2. **Agent / MCP Client:** Build `src/agents/react-agent.js`. Connect the client to the Tool MCP server to read schemas.
3. **The Think Loop:** Modify the LLM prompt to support tool calling. Implement the loop where the LLM decides to search the web -> gets results -> formulates a final answer.
  - *Graceful Failure:* If an MCP tool crashes (e.g., DuckDuckGo is blocked by network), the tool returns a JSON error. The ReAct Agent reads the error and responds: "I tried to search the web but couldn't access it. Here is what I know anyway..."

### Phase 3: Advanced Memory & Context (The Context)
*Goal: Give the assistant short-term and long-term memory.*
1. **Memory MCP Server:** Build `src/mcp-servers/memory/` exposing `store_memory` and `search_memory`.
2. **Short-Term Context:** Implement a rolling window for the current session (e.g., last 10 messages).
3. **Long-Term Memory:** Implement MongoDB or Vector DB (like Chroma) to store important facts about the user.
  - *Graceful Failure:* If MongoDB/VectorDB is unreachable, the Memory MCP Server falls back to an in-memory or Local JSON file backend and warns the user: "Database unreachable, using temporary memory."

### Phase 4: Polish & Qwen-TTS Microservice (The Voice)
*Goal: Add the onboarding flow and the high-quality Python TTS alternative.*
1. **Onboarding Script:** Write a startup script that checks hardware (Mic/Speaker), verifies Ollama models (`llama3.1`), and downloads Whisper/Kokoro ONNX weights.
2. **Python Qwen-TTS Backend:** Build the `python-tts-backend/` with FastAPI to support zero-shot voice cloning.
3. **TTS Switcher:** Update the TTS module to route traffic to the Python API if configured via `.env`.
  - *Graceful Failure:* If the Python TTS backend is offline or fails, automatically fallback to the native Node.js `kokoro-js` engine so the assistant never goes mute.