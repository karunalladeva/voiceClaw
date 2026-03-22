# 🎙️ VoiceClaw: Local Talking LLM Gateway

A highly modular, fully local, Node.js-based voice assistant built with a Next-Generation Multi-Agent Architecture. 

## ❓ Why this application?

The goal of this project is to build a private, open-source alternative to smart assistants (like Alexa) entirely in Node.js. 

Unlike simple "wrapper" applications that just pass text back and forth, VoiceClaw uses a **Hierarchical Multi-Agent Graph** powered by LangGraph. This allows the Master AI to "think" before it speaks, dynamically route complex tasks to specialized Sub-Agents (like Browser or OS Controllers), and remember context—all while running completely locally on your hardware.

## ✨ Architecture 2.0 Features

* **Hierarchical Graph Engine:** The Master Agent dynamically compiles Specialized Skills into isolated Sub-Graphs, allowing nested execution and flawless state bubbling.
* **Macro Execution Bypass:** The Learning Engine automatically extracts successful physical tool sequences (like opening an app or clicking a button) and saves them as deterministic Macros. The next time you ask the same request, it bypasses the LLM entirely for 0ms execution latency.
* **Instant TTS Truncation:** Voice synthesis triggers instantly. The engine uses a lightning-fast native regex truncator to cut audio payloads, completely eliminating secondary LLM summarization bottlenecks.
* **Rolling Vision Context:** An aggressive token eviction manager automatically strips old screenshots from the conversation window, preventing local VRAM out-of-memory (OOM) crashes during heavy "Hover & Verify" visual loops.
* **Flawless Platform Parity:** 
  * **Windows:** C# `user32.dll` execution for exact coordinate clicks.
  * **macOS:** Native AppleScript (JXA) & PyObjC Quartz API for sub-pixel mouse precision.
  * **Android:** Direct ADB `uiautomator dump` XML extraction to find clickable bounds instantly without relying on a Vision LLM.
* **Model Context Protocol (MCP):** A modular "plug-and-play" architecture to dynamically load tools from external MCP servers.

---

## 🚀 How to Install and Run

### Prerequisites
1. **Node.js** (v18 or higher recommended)
2. **Ollama**: You must have [Ollama](https://ollama.com/) installed and running locally.
3. Download a model in Ollama:
   ```bash
   ollama run llama3.1
   ```
4. **(Optional)** If you want to use MongoDB for memory, have a MongoDB server running on `mongodb://localhost:27017` (the agent will gracefully fall back to local files if it's not running).

### Installation

Clone the repository and install the Node.js dependencies:

```bash
npm install
```

### Onboarding & Setup

Before running the server for the first time, run the onboarding script. This will verify your environment, check your Ollama connection, and set up your local `workspace` directory.

```bash
npm run onboard
```

### Running the Node.js Server

Start the development server:

```bash
npm run dev
```

The API will start on `http://localhost:3000`. 

---

## ⚙️ How to Update & Configure

This application features a **Hot-Reloading Configuration** system. You do not need to restart the application to change models or settings.

### Method 1: Edit the config file
When you start the application or run onboarding, it generates a `config.json` file inside the `workspace/` folder. 

Simply edit this file and save it. The server will detect the change and instantly reload the agent and TTS engine with your new settings.

### Method 2: API Endpoints
You can also view and update the configuration programmatically using the API:

* **View Config:** `GET http://localhost:3000/config`
* **Update Config:** `POST http://localhost:3000/config`

---

## 🔌 API Endpoints Reference

* `POST /chat/audio` - Stream audio or text, triggering the Master React Graph and returning streaming audio buffers.
* `POST /listen` - Upload an audio file to get just the text transcription.
* `POST /speak` - Send JSON `{ "text": "Hello world" }` to synthesize audio.
* `GET /onboard` - Run the onboarding system checks.
* `GET /health` - Heartbeat check.