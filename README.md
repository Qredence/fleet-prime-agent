# Prime Agent

A self-improving RLM (Recursive Language Model) coding and research agent. It ships as a web chat interface, a terminal UI, and a headless daemon — all three drive the same core session runtime (`@earendil-works/pi-coding-agent`) through a single typed connection seam.

The **web chat interface** is the primary surface: a React 19 chat application (`web/app`) that streams agent turns over NDJSON, pushes out-of-turn events over SSE, and renders every model action — IPython cells, shell commands, file edits, plans, subagent runs, and interactive questions — as dedicated UI cards.

## Web chat interface

Run it with a single command:

```bash
pnpm --dir web --filter @prime-agent/web dev
```

Open http://127.0.0.1:3000. The browser talks to a single-process Node dev server (TanStack Start + Vite) which drives the coding-agent runtime through `PrimeBridge` (`web/server/src/prime-bridge.ts`): one bridge per process, one `AgentSession` per chat session, with the IPython kernel provisioned per working directory.

## Install from the public repository

Make an empty directory, then run the repository-owned installer. The repository must be public before this raw GitHub URL can be used:

```bash
mkdir -p fleet-prime-agent && cd fleet-prime-agent && \
curl -fsSL https://raw.githubusercontent.com/Qredence/fleet-prime-agent/main/install.sh | sh
```

The installer clones or reuses the checkout in the current directory, installs the root npm workspace and the `web/` pnpm workspace, builds the production web runtime, and links the `prime-agent` command globally. It does not require a PrimeIntellect account or repository access.

Run the built web frontend and backend from any project directory:

```bash
cd /path/to/project
prime-agent web
```

`prime-agent web` uses the current directory as its workspace and binds to `127.0.0.1:3000` by default. Use `prime-agent web --host <host> --port <port> --cwd <directory>` to override those values. The built command runs the packaged Node web runtime; pnpm and Vite are only needed when installing or developing the checkout.

### Conversation

- **Turn-based timeline** — messages are grouped into user→assistant turns; the latest turn streams in place with a "Processing…" shimmer placeholder and a breathing space that keeps the input bar in view while the agent works.
- **Streaming markdown** — assistant text renders through the generative text renderer (`web/design/src/components/openui/`) with syntax-highlighted code.
- **Live activity line** — a composer loader above the input shows the current activity ("Running cell…", plan progress, queue state for steering/follow-up turns).
- **Copy toolbars** — hover-copy for user messages and whole assistant turns, with timestamps.
- **Auto-scroll** — pinned to the latest message, with reduced-motion support.

### Composer

- Auto-resizing textarea: `Enter` sends, `Shift+Enter` inserts a newline, `Alt+Enter` sends a follow-up/steering variant.
- **Model picker** on the left — switch provider/model without leaving the chat (`/model` opens it too).
- **Stop control** on the right — spiral loader plus a stop button during a turn; aborting cancels pending dialogs.
- **Slash-command autocomplete** — typing `/` opens a keyboard-navigable menu (arrows, `Enter`/`Tab` to select, `Escape` to dismiss). Built-ins: `/model`, `/effort` (thinking level), `/settings`, `/new`, `/session` — plus local actions such as `/login`, `/name`, `/context`, `/system-prompt`, `/logs`, `/export`, `/fork`, `/clone`, `/tree`, `/share`, `/import`, `/btw`, `/fast`, `/reload`, `/mcp`, `/heartbeat`, `/changelog`, `/hotkeys`, `/copy`. Aliases `clear`, `usage`, `thinking`, `rename`, `side` resolve like the TUI. Slash commands from skills/prompts are advertised when enabled.
- **Contextual suggestions** — after an assistant reply, suggested follow-ups render as trailing chips; empty states show centered suggestions.
- **Interactive question bar** — when the agent asks for input, a question bar appears above the composer (or inline as a `tool-Question` card) supporting single/multi-select, free text, custom answers, and skip.

### Tool cards

Every tool call the agent makes lands as a card with a lifecycle (`input-streaming → output-available | output-error`), rendered by `web/design/src/components/agent-elements/tools/`:

| Tool | Card |
| --- | --- |
| `tool-IPython` | Jupyter-style cell card: `In [n]` numbering, python/shell chip, `%%bash` support, stdout/stderr/result, kernel-restarted badge |
| `tool-Bash` | Terminal-style card with command summary and output |
| `tool-Edit` / `tool-Write` | Collapsible multi-file diff viewer (`@pierre/diffs`) with light/dark theming |
| `tool-Thinking` | Expandable reasoning block ("Thinking…" shimmer → "Thought") |
| `tool-TodoWrite` / `tool-PlanWrite` | Todo and plan cards with approval states |
| `tool-Task` / `tool-Agent` | Subagent cards, with nested child tool calls grouped onto the parent |
| `tool-Question` | Inline interactive question prompt (submit/skip) |
| `tool-WebSearch`, `tool-Grep`, `tool-Glob`, MCP tools, and more | Icon + title + subtitle rows from the shared tool registry |

### Sessions and chrome

- **Header** — account menu (sign in/out, docs, settings), a session picker popover listing saved conversations (resume by click), and a new-session button.
- **Command palette** — quick access to new session, stop, resume, right-panel views, and theme switching.
- **Right panel** (resizable) — three views: **Resources** (installed packages, skills, prompts, extensions, themes), **Workspace** (file tree, file preview, open-project-folder dialog), and **Artifacts**.
- **Settings dialog** — tabbed: Appearance, Sandbox, Providers, LLM Models, Skills, Pi Harness. Provider credentials (API key / OAuth) and model catalogs are managed here, including model discovery per provider.
- Sessions persist as JSONL transcripts under `~/.prime/agent/sessions/` and can be resumed after a reload; the SSE cursor (`Last-Event-ID`) survives page reloads in `sessionStorage`.

## Highlights

- **Persistent IPython is the built-in model tool** — file operations, shell commands, tool use, subagents, and context management happen through code.
- **Recursive subagents** — `rlm(...)` spawns real child agents for parallel or background work and returns their results programmatically.
- **Self-improving harness** — `/refine` reviews the current trajectory and applies small, evidence-backed updates to supplemental harness state. It never rewrites the immutable base system prompt, and recorded snapshots support rollback.
- **Skills are executable** — skills are importable Python packages; a built-in skill creator turns recurring workflows into project or personal skills.
- **Daemon-backed sessions** — agents keep running when the terminal disconnects and can be reattached later; heartbeats, schedules, and autonomous mode preserve progress across turns.
- **Agent-to-agent communication** — running agents can exchange messages and orchestrate one another without routing through the user.

## Repository layout

npm-workspace for Prime Agent (`packages/*`); pnpm workspace for the Qredence UI (`web/`):

| Path | Package | Purpose |
| --- | --- | --- |
| `packages/ai` | `@earendil-works/pi-ai` | LLM provider abstraction and model registry |
| `packages/agent` | `@earendil-works/pi-agent-core` | Core agent session runtime |
| `packages/coding-agent` | `@earendil-works/pi-coding-agent` | Coding agent CLI, SDK entry point, and daemon |
| `packages/tui` | `@earendil-works/pi-tui` | Terminal UI |
| `web/protocol` | `@prime-agent/web-protocol` | Web wire contract (`ChatStreamEvent`, zod schemas, provider catalog) |
| `web/design` | `@prime-agent/web-design` | Shared web chat components and tool renderers |
| `web/server` | `@prime-agent/web-server` | HTTP adapter (`PrimeBridge`, event mapper, handlers) |
| `web/app` | `@prime-agent/web` | Web chat frontend (TanStack Start host) |
| `prime-agent-runtime` | — | Python IPython kernel shim (requires Python >= 3.10) |

The web frontend (`web/app`) and its UI kit (`web/design`) import the wire contract from `web/protocol`; `web/server` is the only web package that imports `@earendil-works/*`. Install Prime Agent with npm at the repo root, then the UI with `pnpm install` in `web/`.

## Requirements

- Node.js >= 22.8.0
- npm >= 11.10 (enforces the 7-day minimum release age for Prime Agent dependency updates; older npm silently ignores it)
- pnpm >= 11 (Qredence UI under `web/`; `minimumReleaseAge: 10080` in `web/pnpm-workspace.yaml`)
- Git (required by the public-repository installer)
- Python >= 3.10 (only needed for the IPython runtime — `prime-agent-runtime`)

## Getting started

Install workspace dependencies:

```bash
npm ci
pnpm install --dir web
```

### Web chat

```bash
pnpm --dir web --filter @prime-agent/web dev
```

Open http://127.0.0.1:3000. Install the Python runtime shim for full kernel functionality:

```bash
pip install -e prime-agent-runtime
```

On first launch, open Settings → Providers (or run `/login`) to add an API key or subscription provider, then pick a model in the composer.

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
| POST | `/api/chat/command` | Run a slash command server-side |
| GET | `/api/chat/commands` | Slash-command catalog |
| GET | `/api/chat/session` | One session plus messages |
| GET | `/api/chat/sessions?cwd?=` | Session picker |
| GET | `/api/chat/models` | `ModelRegistry.getAll()` |
| POST | `/api/chat/models/discover` | Discover models for a provider |
| GET | `/api/chat/providers` | Provider catalog and credential state |
| POST | `/api/chat/providers` | Upsert a provider credential |
| DELETE | `/api/chat/providers` | Remove a provider |
| GET | `/api/chat/resources` | Packages, skills, prompts, extensions, themes |
| GET | `/api/chat/settings` | Minimal settings subset |
| PATCH | `/api/chat/settings` | Persist `defaultModel` / `defaultProvider` |
| GET | `/api/chat/events` | SSE + ring-buffer replay |
| GET | `/api/workspace/tree` | Workspace file tree |
| GET | `/api/workspace/file` | Read a workspace file |
| GET | `/api/workspace/browse` | Directory listing |
| POST | `/api/workspace/root` | Set the workspace root |
| GET | `/api/health` | Liveness + kernel readiness |

The event mapper (`web/server/src/event-mapper.ts`) is a pure function `AgentSessionEvent → ChatStreamEvent[]`; tool names pass through `toPascalCase` (`tool-IPython`, `tool-Bash`, `tool-Edit`, `tool-Thinking`, …). Tool renderers live in `web/design/src/components/agent-elements/tools/` and dispatch on `part.type`.

Current limitations: no daemon-backed attach (in-process connection), no multi-user auth (binds to `127.0.0.1` with no tokens), and pending dialogs are not persisted across restart. See `web/app/ARCHITECTURE.md` for details.

## Documentation

- `packages/coding-agent/docs/index.md` — documentation index
- `packages/coding-agent/docs/quickstart.md` — install, authenticate, run a first session
- `packages/coding-agent/docs/rlm.md` — RLM programming model, IPython, subagents, skills, trust model
- `packages/coding-agent/docs/development.md` — build and run from source
- `web/app/ARCHITECTURE.md` — web chat architecture
- `AGENTS.md` — contribution rules and required validation

## Development

```bash
npm ci                  # Install Prime Agent (packages/*)
pnpm install --dir web  # Install Qredence UI
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
