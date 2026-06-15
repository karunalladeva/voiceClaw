# Platform patterns (Speed + Accuracy v4)

New context and session code lives under `src/platform/`. Agent runtime (`src/agents/`, orchestration) calls platform services — not the reverse.

## Layout

| Pattern | Location | Role |
|---------|----------|------|
| **Contracts** | `platform/contracts/` | HandoffPointer, RunContext, SSE catalog, evidence schemas |
| **SessionRuntime** | `platform/session/` | Server-issued `sessionId`, scope IDs, TTL cleanup |
| **SessionContextService** | `platform/context/` | Pointer registry, governor, RAG, evidence, upstream registry |
| **Prep** | `platform/prep/prepare-run-context.ts` | Unified chat + org RunContext resolver |
| **Platform tools** | `platform/tools/` | `read_pointer`, `search_session_outputs` |

## Dependency rules

1. `platform/*` must not import from `agents/react-agent.ts` or orchestration task engines.
2. Feature flags under `config.agent.context.*` — legacy paths when disabled.
3. **Raw-before-pointer**: full payload written to disk before ToolMessage pointer JSON.
4. **RunContext** is bound via `AsyncLocalStorage` (`enterWith`) for tool dedup and pointer scope.

## Rollout

Flip flags in admin config or `config.json`. Defaults are enabled in `DEFAULT_CONFIG` for development; set `false` per layer for rollback.
