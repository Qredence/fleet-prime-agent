# Prime Agent

A self-improving RLM (Recursive Language Model) coding and research agent with a terminal UI, a headless daemon, and a web chat interface. The terminal client, RPC, and web adapter all drive the same core session runtime through a single typed connection seam.

## Highlights

- **Persistent IPython is the built-in model tool** — file operations, shell commands, tool use, subagents, and context management happen through code.
- **Recursive subagents** — `rlm(...)` spawns real child agents for parallel or background work and returns their results programmatically.
- **Self-improving harness** — `/refine` reviews the current trajectory and applies small, evidence-backed updates to supplemental harness state. It never rewrites the immutable base system prompt, and recorded snapshots support rollback.
- **Skills are executable** — skills are importable Python packages; a built-in skill creator turns recurring workflows into project or personal skills.
- **Daemon-backed sessions** — agents keep running when the terminal disconnects and can be reattached later; heartbeats, schedules, and autonomous mode preserve progress across turns.
- **Agent-to-agent communication** — running agents can exchange messages and orchestrate one another without routing through the user.
- **Web chat interface** — a React 19 chat frontend that drives the same coding-agent runtime through a Node dev server (`apps/web`).

## Repository layout

npm-workspace monorepo (all packages share one version):

| Path | Package | Purpose |
| --- | --- | --- |
| `packages/ai` | `@earendil-works/pi-ai` | LLM provider abstraction and model registry |
| `packages/agent` | `@earendil-works/pi-agent-core` | Core agent session runtime |
| `packages/coding-agent` | `@earendil-works/pi-coding-agent` | Coding agent CLI, SDK entry point, and daemon |
| `packages/tui` | `@earendil-works/pi-tui` | Terminal UI |
| `packages/web-protocol` | `@prime-agent/web-protocol` | Web wire contract (`ChatStreamEvent`, zod schemas, provider catalog) |
| `packages/web-design` | `@prime-agent/web-design` | Shared web chat components and tool renderers |
| `apps/web` | `@prime-agent/web` | Web chat frontend plus Node server (PrimeBridge) |
| `prime-agent-runtime` | — | Python IPython kernel shim (requires Python >= 3.10) |

## Requirements

- Node.js >= 22.8.0
- npm >= 11.10 (enforces the 7-day minimum release age for dependency updates; older npm silently ignores it)
- Python >= 3.10 (only needed for the IPython runtime — `prime-agent-runtime`)

## Getting started

Install workspace dependencies:

```bash
npm ci
```

### Terminal agent

Run from source (callable from any directory; preserves the caller's working directory):

```bash
/path/to/prime-agent/prime-agent.sh
```

Useful commands:

```bash
prime-agent agents                   # Browse running, idle, and saved sessions
prime-agent attach <agent>           # Reattach to a running session
prime-agent --resume <path|id>       # Resume a saved session
prime-agent status                   # Inspect background service state
prime-agent doctor [--fix]           # Inspect or repair background services
prime-agent update [--force]         # Update Prime Agent
prime-agent shutdown [--force]       # Stop every agent, worker, and background service
```

On first launch, run `/login` to choose a subscription or API-key provider.

### Web chat interface

The web frontend is a single-process Node dev server bound to `127.0.0.1:3000`:

```bash
npm run dev -w @prime-agent/web
```

Open http://127.0.0.1:3000. The server drives `@earendil-works/pi-coding-agent` through PrimeBridge (`apps/web/server/prime-bridge.ts`) — one bridge per Node process, one `AgentSession` per chat session, with the IPython kernel provisioned per working directory. Install the Python runtime shim for full kernel functionality:

```bash
pip install -e prime-agent-runtime
```

## Web architecture

```
browser ─ EventSource/fetch ─▶ TanStack Start server (Node)
                                   │
                                   ▼
                              PrimeBridge
                                   ├─ sessions: Map<sessionId, BridgeSession>
                                   ├─ ringBuffers: Map<sessionId, RingBuffer>  (500 frames)
                                   ├─ pendingDialogs: PendingDialogRegistry   (60s timeout)
                                   └─ kernelReady: Promise<void>              (IPython kernel)
                                   │
                                   ▼
                              packages/coding-agent
```

- **Turns** stream as NDJSON over `POST /api/chat`.
- **Out-of-turn events** (tool questions, status/notify state, agent messages) are pushed over SSE via `GET /api/chat/events?sessionId=` with ring-buffer replay: the client reconnects with the last sequence number (`Last-Event-ID`) and the server replays missed frames; overflow emits a `state: resync-required` frame so the UI falls back to `GET /api/chat/session`.
- `confirm/select/input` become `tool-Question` frames resolved via `POST /api/chat/question`; `notify/setStatus/setWidget` become `state` frames.
- Session history persists as JSONL transcripts under `~/.prime/agent/sessions/`.

API surface:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/chat` | Run a turn; returns NDJSON `ChatStreamEvent` frames |
| POST | `/api/chat/abort` | Abort a turn and cancel pending dialogs |
| POST | `/api/chat/question` | Answer a pending dialog |
| POST | `/api/chat/new` | Create a session (`{cwd, model?, thinkingLevel?}`) |
| POST | `/api/chat/resume` | Resume by `sessionId` / `sessionFile` |
| POST | `/api/chat/model` | `session.setModel()` |
| GET | `/api/chat/session` | One session plus messages |
| GET | `/api/chat/sessions?cwd?=` | Session picker |
| GET | `/api/chat/models` | `ModelRegistry.getAll()` |
| GET | `/api/chat/settings` | Minimal settings subset |
| PATCH | `/api/chat/settings` | Persist `defaultModel` / `defaultProvider` |
| GET | `/api/chat/events` | SSE + ring-buffer replay |
| GET | `/api/health` | Liveness + kernel readiness |

The event mapper (`apps/web/server/event-mapper.ts`) is a pure function `AgentSessionEvent → ChatStreamEvent[]`; tool names pass through `toPascalCase` (`tool-IPython`, `tool-Bash`, `tool-Edit`, `tool-Thinking`, …). Tool renderers live in `packages/web-design/src/components/agent-elements/tools/` and dispatch on `part.type`.

Current limitations (v2): no daemon-backed attach (in-process connection), no multi-user auth (binds to `127.0.0.1` with no tokens), partial workspace tree/reads, and some settings endpoints are stubs. See `apps/web/ARCHITECTURE.md` for details.

## Documentation

- `packages/coding-agent/docs/index.md` — documentation index
- `packages/coding-agent/docs/quickstart.md` — install, authenticate, run a first session
- `packages/coding-agent/docs/rlm.md` — RLM programming model, IPython, subagents, skills, trust model
- `packages/coding-agent/docs/development.md` — build and run from source
- `apps/web/ARCHITECTURE.md` — web chat architecture
- `AGENTS.md` — contribution rules and required validation

## Development

```bash
npm ci                  # Install workspace dependencies
npm run check           # Format, lint, type-check, installer/browser-smoke/rendering checks (does not run tests)
```

Run focused tests from a package root:

```bash
cd packages/coding-agent
npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts
```

Dependency updates are subject to a 7-day minimum release age (`.npmrc` `min-release-age=7`); override only for urgent security patches with `npm install --min-release-age=0 <pkg>`.

## Security note

Prime Agent executes model-generated Python and project commands with your user permissions. Worker and kernel processes improve lifecycle isolation and recovery; they are **not** a security sandbox. Review changes and use trusted repositories, instructions, skills, and extensions only.

## License

MIT — see [LICENSE](LICENSE).
