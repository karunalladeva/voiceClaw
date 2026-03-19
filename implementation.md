# Implementation Playbook

This document breaks down the high-level roadmap into concrete, step-by-step coding tasks. It acts as the execution script for building the **Local Talking LLM** in Node.js.

---

## 1. Project Initialization & Setup

### 1.1 Core Setup
1. Run `npm init -y` to generate `package.json`.
2. Configure TypeScript: 
   ```bash
   npm install -D typescript @types/node ts-node
   npx tsc --init
   ```
   *Update `tsconfig.json` to target ES2022 and resolve CommonJS/ESM modules appropriately.*

### 1.2 Folder Structure Generation
Create the plug-and-play architecture directories:
```bash
mkdir -p src/{agents,mcp-servers/{memory,skills,tools},stt,tts,api}
```

### 1.3 Dependencies Installation
Install the required stack identified in `library.md`:
```bash
# Core & Audio
npm install express cors dotenv
npm install whisper-node kokoro-js node-record-lpcm16 speaker

# LangChain & MCP
npm install @langchain/core @langchain/community @langchain/ollama @langchain/langgraph
npm install @modelcontextprotocol/sdk

# Memory Backends (optional starting out)
npm install mongodb chromadb
```

---

## 2. Phase 1: Core Loop (MVP)

*Goal: Barebones Listen -> Think (no tools) -> Speak loop.*

### 2.1 STT Integration (`src/stt/whisper.ts`)
- Implement a class/wrapper around `whisper-node`.
- Expose a `transcribe(audioBuffer)` method.
- **API Entrypoint (`src/api/server.ts`):** 
  - Create an Express server with a `POST /listen` endpoint that accepts multipart audio uploads.
  - Pipe the upload to the STT module.
- **Graceful Failure:** If STT fails, log a standard error and return `{ error: "Transcription failed" }` to the API or console.

### 2.2 Basic LLM Integration (`src/agents/basic-agent.ts`)
- Create a simple LangChain chain using `ChatOllama` (e.g., `model: "llama3.1"`).
- Connect the STT output string to the LLM prompt.
- **Graceful Failure:** Catch connection refused errors from Ollama and trigger a TTS error string: `"I cannot connect to my brain. Please start Ollama."`

### 2.3 TTS Integration (`src/tts/kokoro.ts`)
- Implement the `kokoro-js` factory using the ONNX backend.
- Expose a `synthesize(text)` method returning an audio stream/buffer.
- **API Entrypoint:** Create a `GET /speak` endpoint to stream the TTS buffer out over HTTP, or use `speaker` to play it locally.

### 2.4 MVP Wiring (`src/index.ts`)
- Wire the components together: wait for microphone input (or API POST), transcribe, pass to basic agent, and synthesize the result.

---

## 3. Phase 2: LangGraph & MCP Tools (The Brain)

*Goal: Upgrade the basic chain into a stateful ReAct Agent that can use tools.*

### 3.1 First Tool Server (`src/mcp-servers/tools/filesystem.ts`)
- Use `@modelcontextprotocol/sdk` to create a local MCP server.
- Expose `read_file` and `write_file` tool schemas and execution logic.

### 3.2 MCP Client Setup (`src/agents/mcp-client.ts`)
- Implement the MCP Client connection logic.
- On startup, connect to the local Tool Server, fetch the schemas, and convert them to LangChain-compatible tools.

### 3.3 LangGraph Agent (`src/agents/react-agent.ts`)
- Define the `StateGraph`.
- Create the core nodes:
  - **Think/LLM Node:** Calls Ollama with bound tools.
  - **Action Node:** If LLM decides to call a tool, execute the MCP Client tool request.
  - **Observe Node:** Return tool results to the LLM.
- **Graceful Failure:** If a tool execution fails, capture the exception and return it as a system message to the LLM so it can formulate an apology/alternative response.

---

## 4. Phase 3: Advanced Memory & Context

*Goal: Provide short-term and long-term memory.*

### 4.1 Memory MCP Server (`src/mcp-servers/memory/index.ts`)
- Create a second MCP server dedicated to memory operations.
- Implement `store_memory` and `search_memory` capabilities.

### 4.2 Database Integration
- Connect the Memory MCP Server to MongoDB (for chat history) and/or ChromaDB (for semantic vector search).
- **Graceful Failure:** Wrap DB connections in try/catch. Fallback to an in-memory JS Array or local JSON file if the databases are unreachable.

---

## 5. Phase 4: Polish & Qwen-TTS Microservice

*Goal: Add Python fallback for zero-shot voice cloning.*

### 5.1 Python Qwen-TTS API (`python-tts-backend/`)
- Set up a virtual environment and install FastAPI and Qwen-TTS.
- Create an `app.py` exposing `/synthesize` and `/clone`.
- Ensure it returns WAV/MP3 buffers.

### 5.2 TTS Switcher Logic (`src/tts/index.ts`)
- Update the TTS module to check `process.env.TTS_ENGINE`.
- If set to `qwen`, make an HTTP POST to the Python FastAPI server.
- **Graceful Failure:** If the HTTP request to the Python server times out, catch the error and fallback instantly to the local `kokoro-js` engine so the assistant does not go mute.

### 5.3 Onboarding Script (`scripts/onboard.ts`)
- Write a CLI script that checks for Ollama, pulls the `llama3.1` model, and pre-downloads the Whisper and Kokoro ONNX weights.