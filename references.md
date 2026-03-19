# Reference Repositories

This document compiles the best, most highly-starred open-source repositories that align with the architecture of our **Local Talking LLM** project. These repositories serve as high-quality references for implementation details regarding local STT/TTS, local LLMs, LangGraph agents, and the Model Context Protocol (MCP) in Node.js/TypeScript.

---

### 1. openclaw/openclaw
*   **Link:** [https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
*   **Stars:** ~323k+
*   **Key Technologies:** TypeScript, Node.js, WebSockets, Local AI, Multi-channel Routing
*   **Relevance:** This is the gold standard for a massive, production-grade local AI assistant built primarily in TypeScript/Node.js. It features a local-first Gateway, multi-agent routing, and cross-platform companion apps. It will serve as the ultimate architectural reference for building a scalable, multi-channel control plane and structuring our Node.js daemon.

### 2. ShayneP/local-voice-ai
*   **Link:** [https://github.com/ShayneP/local-voice-ai](https://github.com/ShayneP/local-voice-ai)
*   **Stars:** ~455+
*   **Key Technologies:** TypeScript, Node.js, Next.js, LiveKit, Whisper, llama.cpp, Kokoro
*   **Relevance:** This is arguably the closest architectural match in the TypeScript ecosystem. It builds a full-stack, Dockerized AI voice assistant utilizing Kokoro for TTS and local Whisper for STT. It is a fantastic reference for how to handle real-time audio streaming (via WebRTC/LiveKit) and how to hook up Kokoro and Whisper in a JS/TS environment.

### 2. vndee/local-talking-llm
*   **Link:** [https://github.com/vndee/local-talking-llm](https://github.com/vndee/local-talking-llm)
*   **Stars:** ~813+
*   **Key Technologies:** Python, Whisper, Ollama, Langchain, ChatterBox TTS
*   **Relevance:** This is the original inspiration for the project. While it is written in Python, it represents the exact flow we are building (Whisper -> LangChain/Ollama -> TTS). It serves as an excellent reference for the core prompt engineering and the logic of bridging STT transcription directly into a LangChain conversational loop.

### 4. ross-sec/kokoro_mcp_server
*   **Link:** [https://github.com/ross-sec/kokoro_mcp_server](https://github.com/ross-sec/kokoro_mcp_server)
*   **Stars:** Growing
*   **Key Technologies:** JavaScript/TypeScript, Kokoro-JS, Model Context Protocol (MCP)
*   **Relevance:** This is a production-ready implementation of an MCP server specifically for Kokoro TTS. Because our architecture relies heavily on MCP, this repository will be an invaluable reference for how to wrap local AI/audio models into compliant MCP servers using pure JavaScript, without relying on Python.

### 5. hideya/mcp-client-langchain-ts
*   **Link:** [https://github.com/hideya/mcp-client-langchain-ts](https://github.com/hideya/mcp-client-langchain-ts)
*   **Stars:** Growing
*   **Key Technologies:** TypeScript, LangChain, MCP SDK
*   **Relevance:** Our agent "brain" acts as an MCP Client using LangGraph. This repository is an excellent minimal reference showing exactly how to use `@modelcontextprotocol/sdk` to connect to local MCP servers, read their tool schemas, and automatically convert them into `LangchainTools` using the `@langchain/core` libraries. It bridges the gap between MCP and LangChain in Node.js.

### 6. langchain-ai/langchain-mcp-adapters
*   **Link:** [https://github.com/langchain-ai/langchain-mcp-adapters](https://github.com/langchain-ai/langchain-mcp-adapters)
*   **Stars:** N/A (Official Library)
*   **Key Technologies:** TypeScript/JavaScript, LangGraph, MCP
*   **Relevance:** This is the official LangChain library for adapting MCP tools into LangGraph agents. Looking through its source code and examples will provide the best practice blueprint for wiring our `ReAct` LangGraph loop to our Memory and Tool MCP Servers.