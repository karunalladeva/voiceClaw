# Error Log

Document any recurring errors, bugs, or system failure points here along with their corresponding solutions or workarounds.

## Known Potential Failure Modes (Handled Gracefully)
- **Microphone Blocked**: Fall back to CLI text input.
- **Ollama Daemon Down**: Agent triggers TTS error "I cannot connect to my brain. Please start Ollama."
- **MCP Tool/Web Search Fails**: Agent intercepts JSON error and replies gracefully using fallback knowledge.
- **Database (MongoDB/Vector DB) Down**: MCP Memory Server falls back to local JSON or in-memory array.
- **Python Qwen-TTS API Down**: Switcher automatically routes back to native `kokoro-js`.

---

*New errors encountered during implementation will be appended below.*
