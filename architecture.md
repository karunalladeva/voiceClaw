# VoiceClaw 2.0 Architecture

## 🏗️ Architecture Diagram

```mermaid
flowchart TD
    subgraph userInteraction [User Interaction]
        userVoice["User Speaks (Microphone)"]
        apiVoice["Audio via API (POST /listen)"]
        speakerOut["Speaker Output"]
    end

    subgraph external [External Systems & Models]
        ollamaService["Ollama Daemon (Llama 3 / LlaVA)"]
        internet["Internet (Search API)"]
        db["Vector DB / Memory SQLite"]
        fileSystem["Local File System"]
        osSystem["Host OS (Win/Mac/Android)"]
    end
    
    subgraph nodeApp [VoiceClaw Application]
        stt["STT Module (whisper-node)"]
        ttsEngine["TTS Engine (Kokoro / Qwen)"]
        macroEngine{"Macro Bypass Engine"}
        
        subgraph hierarchicalGraph [Hierarchical Multi-Agent Graph]
            masterAgent["Master ReAct Agent"]
            visionMemory["Rolling Vision Context Manager"]
            
            subgraph subAgents [Specialized Sub-Agent Skills]
                osSkill["OS Controller Skill"]
                browserSkill["Browser Controller Skill"]
                learnedSkills["User-Learned Skills"]
            end
            
            masterAgent <-->|Route & Bubble State| subAgents
            visionMemory -.->|Evict old screenshots| masterAgent
        end
        
        subgraph nativeTools [Precision OS Controllers]
            winTools["Windows C# Coordinates"]
            macTools["macOS PyObjC Quartz API"]
            androidTools["Android UIAutomator XML"]
        end
    end

    %% Connections
    userVoice -->|Audio Buffer| stt
    apiVoice -->|Audio Buffer| stt
    stt -->|Transcribed Text| macroEngine
    
    %% The Bypass Route
    macroEngine -->|Matched Deterministic Trace| nativeTools
    macroEngine -->|No Match / Complex| masterAgent
    
    %% Graph Execution
    masterAgent <-->|LLM Prediction| ollamaService
    subAgents <-->|LLM Prediction| ollamaService
    
    subAgents -->|Invoke Tool| nativeTools
    nativeTools <-->|Physical Execution| osSystem
    
    masterAgent <-->|Fetch/Save| db
    subAgents <-->|Fetch| internet
    subAgents <-->|Read/Write| fileSystem
    
    %% Audio Out Pipeline
    masterAgent -->|Zero-Latency Regex Truncator| ttsEngine
    ttsEngine -->|Audio Data| speakerOut
```

## System Components

1. **Hearing (STT)**: Receives raw audio via microphone OR via an exposed API endpoint and transforms it to text using the local `whisper-node` bindings.
2. **Macro Bypass Engine**: The lightning-fast gatekeeper. If the user's intent matches a previously learned deterministic physical shortcut (Macro), it routes execution natively to OS controllers instantly (0ms latency), completely bypassing the LLM.
3. **Thinking (Hierarchical Graph)**: The main brain. The Master Agent evaluates context and dynamically routes execution into isolated `CompiledStateGraph` Sub-Agents (Skills) for hyper-focused tasks. State bubbles back up flawlessly.
4. **Precision OS Controllers**: The physical interactors. Unlike basic wrappers, VoiceClaw interacts exactly like a mouse using high-level native bridging: C# `user32` for Windows, PyObjC Quartz for macOS, and ADB XML tree extractions for Android.
5. **Rolling Context Manager**: Intercepts the conversational history to aggressively summarize or drop old `image_url` payloads, preventing Out-Of-Memory system crashes during dense visual analysis loops.
6. **Speaking (TTS)**: Instantaneous text-to-speech. By stripping Markdown using native regex instead of a secondary LLM summarization pass, it feeds text directly to `kokoro-js` with zero algorithmic latency.