# Node.js Local Talking LLM Architecture

## 🏗️ Architecture Diagram

```mermaid
flowchart TD
    subgraph userInteraction [User Interaction]
        userVoice["User Speaks (Microphone)"]
        apiVoice["Audio via API (POST /listen)"]
        speakerOut["Speaker Output"]
        apiOutput["API Response (e.g. GET /speak)"]
    end

    subgraph mcpNetwork [MCP Network]
        mcpClient["MCP Client (Agent)"]
        mcpTools["MCP Tool Servers (Web, Files)"]
        mcpMemory["MCP Memory Server (Vector DB/Mongo)"]
    end
    
    subgraph nodeApp [Node Application]
        stt["STT Module (whisper-node)"]
        agent["ReAct Agent (Ollama Model)"]
        ttsEngine["TTS Engine Switcher"]
        
        subgraph agentLoop [Agent Think Loop]
            llmThink["LLM Predicts Next Step"]
        end
        
        subgraph ttsOptions [TTS Implementations]
            kokoro["Kokoro-JS (Native Node/ONNX)"]
            qwen["Qwen-TTS (Python API)"]
        end
    end

    subgraph external [External Systems]
        ollamaService["Ollama Daemon"]
        internet["Internet (Search API)"]
        db["MongoDB / Vector DB"]
        fileSystem["Local File System"]
    end

    %% Connections
    userVoice -->|Audio Buffer| stt
    apiVoice -->|Audio File/Buffer| stt
    stt -->|Transcribed Text| agent
    
    agent <-->|Integrates| mcpClient
    mcpClient <-->|MCP Protocol| mcpMemory
    mcpClient <-->|MCP Protocol| mcpTools
    
    mcpMemory <-->|Read/Write Context| db
    mcpTools <-->|Fetch Data| internet
    mcpTools <-->|Read/Write| fileSystem
    
    agent -->|Context + Prompt| llmThink
    llmThink <-->|Query via Client| mcpClient
    
    llmThink -->|Requires LLM Eval| ollamaService
    ollamaService -->|LLM Response| llmThink

    llmThink -->|Final Answer Text| ttsEngine
    
    ttsEngine -->|Use Configured Option| kokoro
    ttsEngine -->|Use Configured Option| qwen
    
    kokoro -->|Audio Data| speakerOut
    qwen -->|Audio Data| speakerOut
    
    kokoro -->|Audio File/Stream| apiOutput
    qwen -->|Audio File/Stream| apiOutput
```

## System Components

1. **Hearing (STT)**: Receives raw audio via microphone OR via an exposed API endpoint (`POST /listen`) and transforms it to text using the local `whisper-node` bindings.
2. **Thinking (Agent/MCP)**: The Agent acts as an MCP Client. It consults with the `Ollama Daemon` and connected MCP servers for memory and tool utilization, executing a "think-act-observe" loop.
3. **Memory / Context**: MCP server handling transient (rolling context) and persistent (MongoDB/Vector DB) chat history.
4. **Tools & Skills**: Discrete MCP servers for local file system operations and web connectivity.
5. **Speaking (TTS)**: Dual-engine setup that delegates speech synthesis to either lightweight Node.js `kokoro-js` or high-fidelity Python-based Qwen-TTS based on configuration and availability. The resulting audio buffer can be played on local speakers OR returned as an API stream (`GET /speak`).