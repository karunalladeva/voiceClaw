# Library Documentation

This document serves as the central source of truth for the technology stack, documenting exactly what packages are being used in the Local Talking LLM project and the reasoning behind each choice.

## 1. Core Runtime & Server
- **`node` (v18+)**: The primary event-driven environment handling the asynchronous "think-listen-speak" loops.
- **`express`**: Used to expose REST API endpoints (e.g., `POST /listen`), allowing the system to accept audio from external sources instead of just the local microphone.

## 2. Hearing (Speech-to-Text)
- **`whisper-node`**: C++ bindings for whisper.cpp. 
  - *Why:* Chosen because it runs completely locally and incredibly fast on CPU/GPU without needing a heavy Python runtime or internet connection.
- **`node-record-lpcm16`**: 
  - *Why:* The most reliable standard package for capturing raw 16-bit PCM audio streams natively from the system microphone in Node.js.

## 3. Thinking (LLM, Agent, & Context)
- **`@langchain/core` & `@langchain/community`**: 
  - *Why:* The industry standard framework for building complex LLM applications in JavaScript. We use it to orchestrate prompts, tool calling, and chaining.
- **`@langchain/langgraph`**: 
  - *Why:* To build the actual ReAct Agent loop. LangGraph allows us to define the "Think -> Act -> Observe" cycle as a stateful, cyclic graph, which is far more robust and controllable than simple while-loops or basic chains.
- **`ollama`** (via LangChain's `@langchain/ollama` wrapper): 
  - *Why:* To interact with the local Ollama daemon using a standardized LangChain ChatModel interface. It supports native tool schemas, making it perfect for our `llama3.1` or `llama3.2` models.
- **`@modelcontextprotocol/sdk`**: 
  - *Why:* The official MCP SDK. We will bridge MCP tools into LangChain tools. It completely decouples our agent's brain from its capabilities, making it highly modular.
- **`mongodb`** or **`chromadb`** (npm packages): 
  - *Why:* To serve as the storage layer for the Memory MCP Server, enabling long-term semantic context retention.

## 4. Speaking (Text-to-Speech)
- **`kokoro-js`**: 
  - *Why:* The primary TTS engine. It provides state-of-the-art voice quality (82M params) but is built on ONNX, meaning it runs 100% locally inside the Node.js process with zero network latency and no Python requirement.
- **`speaker`** or **`play-sound`**: 
  - *Why:* Standard Node.js libraries for piping the generated audio buffer back to the user's hardware speakers.

## 5. Optional Python Backend (For Qwen-TTS Voice Cloning)
*If the user enables the high-fidelity Phase 4 fallback:*
- **`fastapi`** / **`uvicorn`**: 
  - *Why:* The industry standard for standing up a blazing-fast, lightweight local Python API.
- **`qwen-tts`**: 
  - *Why:* Offers capabilities that `kokoro-js` does not, specifically high-fidelity zero-shot voice cloning from a short 3-second audio sample.