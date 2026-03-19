# 🎙️ Local Talking LLM Gateway

A highly modular, fully local, Node.js-based voice assistant built with an agentic architecture. 

## ❓ Why this application?

The goal of this project is to build a private, open-source alternative to smart assistants (like Alexa) entirely in Node.js. 

Unlike simple "wrapper" applications that just pass text back and forth, this application uses a **ReAct (Reasoning and Acting) Agent** powered by LangGraph. This allows the AI to "think" before it speaks, use tools to interact with your file system, and remember context—all while running completely locally on your hardware.

## ✨ What we support

* **Local Speech-to-Text (STT):** Uses OpenAI's Whisper model locally (`whisper-node`) to accurately transcribe your voice.
* **Agentic LLM Brain:** Powered by local `Ollama` models (e.g., `llama3.1`). Uses a LangGraph ReAct loop, allowing the agent to decide when to answer directly or when to use a tool.
* **Model Context Protocol (MCP):** A highly modular "plug-and-play" architecture for skills and tools. The agent dynamically loads tools (like reading/writing files or searching memory) from external MCP servers.
* **High-Quality Text-to-Speech (TTS):** Uses native Node.js `kokoro-js` (ONNX) for incredibly fast and natural voice synthesis. Designed with a fallback "switcher" system to support Qwen-TTS microservices in the future.
* **Hot-Reloading Configuration:** Change your LLM model or TTS voices on the fly without ever restarting the server.
* **RESTful API:** Exposes endpoints for Audio Ingestion, Configuration, and Onboarding.

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
5. **(Optional)** If you want to use the Qwen-TTS microservice, you need Python installed.

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
*You can perform a health check by visiting `http://localhost:3000/health`.*

### Running the Python Qwen-TTS Microservice (Optional)

If you want to use Qwen-TTS instead of Kokoro, you need to run the Python backend alongside the Node.js server.

```bash
cd python-tts-backend
pip install -r requirements.txt
python app.py
```
*The Python server will start on `http://localhost:8000`. You can then update your config (via the API or `workspace/config.json`) to set the `tts.engine` to `"qwen"`.*

---

## ⚙️ How to Update & Configure

This application features a **Hot-Reloading Configuration** system (similar to OpenClaw). You do not need to restart the application to change models or settings.

### Method 1: Edit the config file
When you start the application or run onboarding, it generates a `config.json` file inside the `workspace/` folder. 

Open `workspace/config.json` in your editor:
```json
{
  "llm": {
    "model": "llama3.1",
    "temperature": 0.2
  },
  "tts": {
    "engine": "kokoro",
    "defaultVoice": "af_heart"
  }
}
```
Simply edit this file and save it. The server will detect the change and instantly reload the agent and TTS engine with your new settings.

### Method 2: API Endpoints
You can also view and update the configuration programmatically using the API:

* **View Config:** `GET http://localhost:3000/config`
* **Update Config:** `POST http://localhost:3000/config`
  ```json
  // Request Body
  {
    "llm": {
      "temperature": 0.5
    }
  }
  ```

---

## 🔌 API Endpoints Reference

* `POST /chat/audio` - Upload an audio file (microphone recording). The server will transcribe it, route it through the Agent, generate a voice response, and return the `.wav` audio file.
* `POST /listen` - Upload an audio file to get just the text transcription.
* `POST /speak` - Send JSON `{ "text": "Hello world" }` to get a synthesized `.wav` audio file back.
* `GET /onboard` - Run the onboarding system checks via API.
* `GET /health` - Check if the server is alive.