# VoiceClaw

**Run an entire AI company as one person.** VoiceClaw is a production-ready, local-first platform that lets a solo founder operate a full virtual organization — CEO, engineers, analysts, traders, and support — through orchestrated AI agents, voice chat, and real-time admin control.

You stay in the chair. Your agents do the work: tasks, routines, budgets, approvals, and trading pipelines — all from one dashboard on your own hardware.

---

## Flagship: One-person AI company

VoiceClaw’s core idea is **one human, one company, many agents**. You create a company with a mission, hire AI roles into an org chart, assign goals and tasks, and let heartbeats drive execution while you approve hires, spend, and high-priority work.

```
        You (founder / board)
                 │
                 ▼
        ┌────────────────┐
        │  Your Company  │  mission · budgets · governance
        └────────┬───────┘
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
  CEO agent   Engineers    Analyst / Trader
  (strategy)  (build/run)  (research · markets)
    │            │            │
    └────────────┴────────────┘
                 │
         Tasks · Routines · Heartbeats
                 │
         Voice chat · Channels · Skills
```

| Capability | What it means for you |
|------------|------------------------|
| **Company & org chart** | Name your company, set a mission, add agents with roles (CEO, CTO, engineer, analyst, marketer, …) and reporting lines |
| **Task board** | Backlog → done workflow; assign work to agents; auto-trigger heartbeats on new tasks |
| **Governance** | You approve hires, budget increases, and sensitive tasks — agents don’t run unchecked |
| **Budgets** | Per-agent and company-wide spend limits in USD |
| **Routines** | Scheduled recurring work (cron-style) for always-on operations |
| **Trading desk** | Financial analyst skill, market MCP, portfolio templates |
| **Creator** | Generate skills and workspace assets to grow what your company can do |
| **Activity log** | Full audit trail of company, agent, task, and approval events |

**Where to use it:** Admin → **Orchestration** at `http://localhost:3000/admin/` (API under `/orchestration/*`).

---

## Production-ready capabilities

| Area | What you get |
|------|----------------|
| **One-person company** | Virtual org with agents, tasks, budgets, approvals, routines, trading — you are the board |
| **Voice & chat API** | SSE streaming for text and audio (`/chat/text`, `/chat/audio`), TTS, STT, abort/barge-in |
| **Admin console** | Real-time dashboard at `/admin/` — metrics, MCP health, settings, orchestration command center |
| **Web chat** | Standalone chat UI at `/admin/chat` — history, markdown replies, voice input (mobile parity) |
| **Channels** | Bidirectional Discord, Telegram, WhatsApp, and pipeline integrations |
| **Evolution / self-tune** | Model evolution service, training scripts, Flutter evolution UI |
| **Hot config** | `workspace/config.json` reloads without restart; REST config API |
| **Observability** | Health endpoint, optional LangSmith tracing, admin WebSocket event stream |
| **Cross-platform clients** | Flutter app (Windows, macOS, Android, iOS) + React admin SPA |

---

## Architecture

```
                         You (solo founder)
                                 │
                                 ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────────┐
│  Flutter Client │     │  Admin Web SPA   │     │  External Channels      │
│  voice · chat   │     │  Orchestration   │     │  Discord · Telegram · … │
└────────┬────────┘     │  /admin · /chat  │     └────────────┬────────────┘
         │              └────────┬─────────┘                    │
         └───────────────────────┼────────────────────────────┘
                                 ▼
                    ┌────────────────────────────┐
                    │   Express API  :3000       │
                    │   Orchestration (company)  │
                    │   React Agent · MCP · TTS  │
                    └────────────────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
   AI agent workforce      workspace/              MCP · Market · GitHub
   CEO · eng · analyst     companies · tasks        tools & data feeds
```

**Core engine highlights**

- **One-person company orchestration** — companies, org agents, heartbeats, governance, and budgets in `src/orchestration/`.
- **Hierarchical multi-agent graph** (LangGraph) — master agent delegates to skill sub-graphs for execution.
- **Macro bypass** — successful tool sequences cached for deterministic replay.
- **MCP plug-ins** — dynamic tool loading from Model Context Protocol servers.
- **Platform tools** — Windows, macOS, and Android automation with vision context management.

---

## Prerequisites

| Requirement | Version / notes |
|-------------|-----------------|
| **Node.js** | 18+ (20 LTS recommended) |
| **npm** | 9+ |
| **Ollama** | [Install Ollama](https://ollama.com/) and pull a model, e.g. `ollama pull llama3.1` |
| **Flutter** | 3.10+ (only if building mobile/desktop clients) |
| **MongoDB** | Optional — memory MCP falls back to local files |
| **Redis** | Optional — used by some channel/orchestration features |

---

## Quick start (development)

### 1. Clone and install

```bash
git clone <your-repo-url> voice-to-voice
cd voice-to-voice
npm install
```

### 2. Environment

```bash
cp .env.example .env
# Edit .env — set PORT, API keys, channel tokens as needed
```

### 3. Onboard

Verifies Ollama, creates `workspace/`, and writes initial `config.json`:

```bash
npm run onboard
```

### 4. Build admin UI (required for `/admin` in production)

```bash
npm run admin:build
```

### 5. Start the server

```bash
npm run dev
```

Or use the helper script (backend only):

```bash
./start.sh
```

### 6. Open the applications

| Application | URL |
|-------------|-----|
| Health check | http://localhost:3000/health |
| Admin dashboard | http://localhost:3000/admin/ |
| **One-person company (Orchestration)** | http://localhost:3000/admin/ → **Orchestration** tab |
| Web chat | http://localhost:3000/admin/chat |
| API config | http://localhost:3000/config |

**Admin dev mode** (hot reload, proxies API to `:3000`):

```bash
npm run admin:dev
# → http://localhost:5173/admin/
```

### 7. Flutter client (optional)

```bash
cd client
flutter pub get
flutter run -d windows   # or macos, android, ios
```

Point the app at your server URL in settings (default `http://localhost:3000`).

---

## Production deployment

### Build artifacts

```bash
# Compile TypeScript backend
npm run build

# Build admin SPA into src/admin/public/
npm run admin:build
```

### Run in production

```bash
export NODE_ENV=production
export PORT=3000
node dist/index.js
```

Use a process manager (**systemd**, **PM2**, or **Docker**) to keep the process alive and restart on failure.

**Example PM2**

```bash
npm run build && npm run admin:build
pm2 start dist/index.js --name voiceclaw
pm2 save
```

### Reverse proxy (recommended)

Terminate TLS and proxy to Node on `127.0.0.1:3000`. Example **nginx** snippet:

```nginx
server {
    listen 443 ssl;
    server_name voiceclaw.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
        client_max_body_size 50M;
    }
}
```

WebSocket admin feed: `wss://your-host/admin/ws`

### Production checklist

- [ ] Set `NODE_ENV=production`
- [ ] Run `npm run build` and `npm run admin:build` before deploy
- [ ] Configure `.env` (never commit secrets)
- [ ] Restrict network access to admin routes if exposed publicly
- [ ] Use HTTPS in front of the API
- [ ] Ensure Ollama (or cloud LLM keys) is reachable from the server
- [ ] Configure `workspace/channels.json` for production channel tokens
- [ ] Verify `GET /health` returns OK from your load balancer
- [ ] Optional: enable LangSmith (`LANGCHAIN_TRACING_V2=true`) for tracing

---

## Configuration

Configuration is **hot-reloaded** from `workspace/config.json` — no restart required for model or voice changes.

| Method | Endpoint / path |
|--------|-----------------|
| File | `workspace/config.json` |
| REST | `GET` / `POST` http://localhost:3000/config |
| Admin UI | Settings tab at `/admin/` |

Channel integrations use `workspace/channels.json` and `.env` tokens. See [channels.md](./channels.md).

---

## Web applications

### Admin dashboard (`/admin/`)

- **Orchestration (one-person company)** — create a company, build your org chart, run the task board, approve hires and spend, schedule routines, open the trading desk and creator
- Live runtime metrics (WebSocket): requests, tokens, MCP health, active skill agents
- Multi-agent flow visualization and system event logs
- Settings: models, memory, skills, workspace files
- Header voice pill: wake word, VAD, streaming audio chat

#### Start your company in 3 steps

1. Open **Orchestration** → **Create First Company** (name + mission).
2. Add agents (**Organization** tab) — e.g. CEO for planning, engineers for execution, analyst for research.
3. Create tasks, enable heartbeats, and approve work from the **Overview** / **Budget** / **Activity** tabs.

### Chat (`/admin/chat`)

Dedicated full-page chat (not embedded in the dashboard):

- Conversation sidebar (new / switch / delete)
- Text and microphone input with SSE streaming
- Markdown-rendered agent responses
- Stop, retry, and TTS audio playback

Rebuild after UI changes:

```bash
npm run admin:build
```

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness / readiness |
| `POST` | `/chat/text` | Text chat (SSE stream) |
| `POST` | `/chat/audio` | Voice chat (multipart audio, SSE) |
| `GET` | `/chats` | List conversations |
| `GET` | `/chats/:id` | Load conversation messages |
| `DELETE` | `/chats/:id` | Delete conversation |
| `POST` | `/chat/reset` | Reset conversation context |
| `POST` | `/listen` | STT only |
| `POST` | `/speak` | TTS synthesis |
| `GET` | `/config` | Read configuration |
| `POST` | `/config` | Update configuration |
| `GET` | `/admin/api/*` | Admin REST (stats, agents, models, system) |
| `WS` | `/admin/ws` | Admin real-time events |

**Orchestration (one-person company)** — `GET/POST /orchestration/companies`, `/orchestration/agents`, `/orchestration/tasks`, `/orchestration/approvals`, `/orchestration/budget/*`, `/orchestration/routines`, heartbeats, and activity logs. See `src/orchestration/routes.ts`.

Creator, evolution, and channel routes: `src/creator/routes.ts`, `src/api/server.ts`.

**ComfyUI (image/video generation)** — `GET/POST /comfyui/*` when `comfyui.enabled` is true. See [ComfyUI integration](#comfyui-image--video-generation) below.

---

## ComfyUI image & video generation

VoiceClaw can generate images and videos by submitting workflows to a [ComfyUI](https://github.com/comfyanonymous/ComfyUI) server via its native REST + WebSocket API.

### Prerequisites

1. **ComfyUI running** (default `http://127.0.0.1:8000`)
2. **Models** matching bundled workflows (e.g. `v1-5-pruned-emaonly.safetensors` for `txt2img-basic`)
3. **Custom nodes** for video (`txt2video-basic` requires ComfyUI-AnimateDiff-Evolved)

### Enable in config

**Admin UI:** Settings → **ComfyUI** → Connection section → enable, set server URL, save.

Or add to `workspace/config.json` manually:

```json
{
  "comfyui": {
    "enabled": true,
    "baseUrl": "http://127.0.0.1:8000",
    "requestTimeoutMs": 300000,
    "outputDir": "workspace/generated",
    "maxConcurrentJobs": 1
  }
}
```

Optional env override: `COMFYUI_BASE_URL=http://127.0.0.1:8000` in `.env`.

### Chat / voice usage

Ask naturally: *"Draw a sunset over mountains"* or *"Create a video of ocean waves."* The master agent routes to the **comfyui-creator** skill, which uses `txt2img-basic` for images and `txt2video-basic` for video.

### Custom workflows

Drop workflow JSON files into `workspace/comfyui/workflows/`. Each file uses this wrapper format:

```json
{
  "id": "my-workflow",
  "name": "My Workflow",
  "type": "image",
  "description": "What this workflow does",
  "injections": {
    "prompt": { "nodeId": "6", "field": "text" },
    "negativePrompt": { "nodeId": "7", "field": "text" },
    "seed": { "nodeId": "3", "field": "seed" },
    "width": { "nodeId": "5", "field": "width" },
    "height": { "nodeId": "5", "field": "height" }
  },
  "workflow": { ... ComfyUI API-format graph ... }
}
```

Workspace workflows override bundled templates with the same `id`. Reload without restart: `POST /comfyui/workflows/reload`.

Bundled defaults live in `template/comfyui/`.

### Admin UI (Settings → ComfyUI)

Open **Admin** → **Settings** → **ComfyUI** tab (`/admin/`):

| Feature | What it does |
|---------|----------------|
| **Server status** | Shows whether ComfyUI is enabled and reachable |
| **Upload JSON** | Upload wrapper or raw ComfyUI workflow to `workspace/comfyui/workflows/` |
| **Import from ComfyUI** | Lists workflows saved in ComfyUI (`userdata/workflows/`), auto-suggests injections, import to workspace |
| **Edit injections** | Expand a workspace template to edit prompt/seed/width node mappings |
| **Delete** | Remove workspace templates (bundled templates are read-only) |
| **Reload registry** | Rescan template folders without restarting the server |

### REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/comfyui/health` | ComfyUI reachability and queue status |
| `GET` | `/comfyui/workflows` | List available workflows |
| `GET` | `/comfyui/workflows/:id` | Get full workflow with injections |
| `PUT` | `/comfyui/workflows/:id` | Update workspace workflow |
| `DELETE` | `/comfyui/workflows/:id` | Delete workspace workflow |
| `POST` | `/comfyui/workflows/upload` | Upload JSON template (multipart `file`) |
| `POST` | `/comfyui/workflows/import` | Import from ComfyUI userdata |
| `GET` | `/comfyui/userdata/workflows` | List workflows saved in ComfyUI |
| `POST` | `/comfyui/workflows/reload` | Reload workspace workflows |
| `POST` | `/comfyui/generate` | Submit generation job |
| `GET` | `/comfyui/jobs/:promptId` | Poll job status |
| `GET` | `/comfyui/outputs/:promptId/:filename` | Download generated file |

**Generate an image:**

```bash
curl -X POST http://localhost:3000/comfyui/generate \
  -H "Content-Type: application/json" \
  -d '{"workflowId":"txt2img-basic","prompt":"sunset over mountains","width":512,"height":512}'
```

**Async mode (long video jobs):**

```bash
curl -X POST "http://localhost:3000/comfyui/generate?async=true" \
  -H "Content-Type: application/json" \
  -d '{"workflowId":"txt2video-basic","prompt":"ocean waves on a beach"}'

curl http://localhost:3000/comfyui/jobs/{promptId}
```

Outputs are saved under `workspace/generated/{promptId}/` and served at `/comfyui/outputs/{promptId}/{filename}`.

---

## Project structure

```
voice-to-voice/
├── client/                 # Flutter mobile/desktop app
├── src/
│   ├── api/                # Express server & chat routes
│   ├── admin/              # Admin server + React SPA
│   │   ├── app/            # Vite source (src/admin/app)
│   │   └── public/         # Built admin assets (after admin:build)
│   ├── agents/             # React agent, learning engine, MCP client
│   ├── orchestration/      # Multi-agent company/task system
│   ├── services/           # Evolution, PII sanitizer, schedulers
│   ├── pipeline/           # Channels & pipeline engine
│   ├── creator/            # Workspace/skill creator
│   ├── comfyui/            # ComfyUI REST routes
│   ├── skills/             # Skill implementations & manifests
│   └── tools/              # OS, market, finance, ComfyUI tools
├── workspace/              # Runtime config, chats, skills (created at onboard)
├── scripts/                # Onboard, evolution training, skill generation
├── template/               # Trading & ComfyUI workflow templates
├── channels.md             # Channel setup guide
├── start.sh                # Dev launcher (backend)
└── .env.example            # Environment template
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API server (ts-node) |
| `npm run build` | Compile backend to `dist/` |
| `npm run onboard` | First-time setup & health checks |
| `npm run admin:dev` | Admin Vite dev server |
| `npm run admin:build` | Build admin SPA to `src/admin/public/` |
| `npm run generate-skill` | Skill scaffolding helper |

---

## Security notes

- Run behind a reverse proxy with TLS for any internet-facing deployment.
- Treat `workspace/` as sensitive — it may contain chat history and credentials.
- Restrict admin URLs (`/admin`, `/admin/chat`, `/admin/ws`) to trusted networks or add authentication at the proxy layer (not included by default).
- Store API keys in `.env` or a secrets manager, not in `config.json` committed to git.

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| Admin UI 404 | Run `npm run admin:build` |
| Chat page blank | Open `/admin/chat`; ensure backend serves SPA fallback |
| No LLM response | Check Ollama is running; run `npm run onboard` |
| Microphone blocked | Use HTTPS or localhost; grant browser/OS permissions |
| MCP tools failing | Verify tokens in `.env`; check admin MCP metrics |
| High VRAM usage | Reduce vision context in config; check `vram-monitor` logs |
| ComfyUI unreachable | Start ComfyUI; set `comfyui.enabled` and `COMFYUI_BASE_URL`; check `/comfyui/health` |

---

## Documentation

- [Bidirectional channels](./channels.md)
- [Admin app (dev)](./src/admin/app/README.md)
- Graphify knowledge graph: `graphify-out/GRAPH_REPORT.md` (when generated)

---

## License

ISC — see package metadata. Use and deploy at your own risk; review security settings before production exposure.
