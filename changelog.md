# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `plan.md` created with multi-phase implementation details and architecture description.
- `architecture.md` created to document system data flows and architectural diagram.
- `library.md` created to document all dependencies and rationale.
- `changelog.md` and `errorlog.md` initialized.
- Defined Plug-and-Play Model Context Protocol (MCP) folder structure.
- Planned integration of `whisper-node`, `kokoro-js`, `Ollama` and Python `Qwen-TTS`.

### Changed
- Updated architecture to support Audio input/output via API endpoints (`POST /listen`, `GET /speak`) alongside local mic/speaker.
- Refined the Thinking module in `library.md` to utilize `@langchain/core`, `@langchain/ollama`, and `@langchain/langgraph` to construct stateful, robust ReAct Agent loops.