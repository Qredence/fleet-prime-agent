# Prime-Agent Web Architecture

Isolated npm workspace that drives `prime-agent` (`@earendil-works/pi-coding-agent`) from a single-process Node dev server. Ported from `fleet-pi`'s chat UI, adapted for prime-agent's SDK surface.

## Process boundary

```
browser ─ EventSource/fetch ─▶ TanStack Start server (Node)
                                   │
                                   ▼
                              PrimeBridge
                                   │  (1 instance per Node process — see server/singleton.ts)
                                   ├─ sessions: Map<sessionId, BridgeSession>
                                   ├─ ringBuffers: Map<sessionId, RingBuffer>   (500 frames)
                                   ├─ pendingDialogs: PendingDialogRegistry     (60s timeout)
                                   └─ kernelReady: Promise<void>                (IpythonKernelProvisioner.ensure)
                                             │
                                             ▼
                              packages/coding-agent
                                   │
                                   ├─ createAgentSession({cwd}) ─▶ AgentSession
                                   ├─ SessionManager.list/openAsync ─▶ JSONL transcripts
                                   └─ IpythonKernelProvisioner ─▶ Jupyter kernel readiness
```

The bridge binds an `ExtensionUIContext` per session. `confirm/select/input`
become `tool-Question` frames + pending-dialog promises resolved via
`POST /api/chat/question`. `notify/setStatus/setWidget` become `state` frames.
Sessions subscribe via `session.subscribe(mapAgentSessionEvent)` → ring buffer
→ listeners.

## Wire surface

NDJSON-over-POST for streaming a turn (`POST /api/chat`), SSE for out-of-turn
pushes (`GET /api/chat/events?sessionId=`, ring-buffer replay with
`Last-Event-ID`). After a 0.5s+ drop, the client reconnects with the last seq
and the server replays missed frames; overflow emits a `state: resync-required`
frame so the UI falls back to `GET /api/chat/session`.

| Method | Path                       | Purpose                                       |
| ------ | -------------------------- | --------------------------------------------- |
| POST   | /api/chat                  | Run a turn, returns NDJSON `ChatStreamEvent`  |
| POST   | /api/chat/abort            | Abort + cancel pending dialogs                |
| POST   | /api/chat/question         | Answer a pending dialog                       |
| POST   | /api/chat/new              | Create session (`{cwd,model?,thinkingLevel?}`)|
| POST   | /api/chat/resume           | Resume by `sessionId` / `sessionFile`         |
| POST   | /api/chat/model            | `session.setModel()`                          |
| GET    | /api/chat/session          | One session + messages                        |
| GET    | /api/chat/sessions?cwd?=   | Session picker                                |
| GET    | /api/chat/models           | `ModelRegistry.getAll()`                      |
| GET    | /api/chat/settings         | Minimal settings subset                       |
| PATCH  | /api/chat/settings         | Persist `defaultModel`/`defaultProvider`      |
| GET    | /api/chat/events           | SSE + ring-buffer replay                      |
| GET    | /api/health                | Liveness + kernel readiness                   |

## Mapper

`server/event-mapper.ts` is a pure function `AgentSessionEvent →
ChatStreamEvent[]`. Tool names pass through `toPascalCase` with `IPython` and
short-acronym special-casing, producing `tool-IPython | tool-Bash | tool-Edit |
tool-Thinking | …`. All tool parts land on `ChatToolPart.state: input-streaming
→ output-available | output-error`.

## Tool renderers

`packages/design/src/components/agent-elements/tools/` dispatches on
`part.type`:

- `tool-IPython` → `ipython-tool.tsx` (cell-numbered, kernel-restarted badge,
  ±stdout/stderr/result, singlefile Python or `%%bash` marker chip)
- `tool-Bash`, `tool-Edit` → existing copied `_bash/_edit-tool.tsx`
- `tool-Thinking`, `tool-TodoWrite`, `tool-PlanWrite`, `tool-Task`, `tool-Agent`,
  `tool-Question`, `tool-WebSearch|Grep|Glob` — existing
- everything else → `GenericTool` from `toolRegistry` (icon, title, subtitle)

Workspace runtime cards (`project_inventory`, `resource_install`,
`workspace_index`, `workspace_write`) are dropped in v1; `PI_TOOL_RENDERERS`
is exported as an empty table to keep the chat shell's wiring type-safe.

## Client SSE flow

`usePiChat` opens one `EventSource` per in-flight `sessionId`. The NDJSON turn
stream remains authoritative during an active turn (frames are skipped by the
SSE handler when `status === "streaming" | "submitted"`); out-of-turn pushes
(`tool-Question` requests, `state` frames for `notify`/`setStatus`,
`ipython_sent_agent_message`) are applied to the same reducer.

`Last-Event-ID` sequence numbers persist in `sessionStorage` so a page reload
resumes the SSE cursor without a server round-trip; session-reload requests
continue through `chatClient.resumeSession` (fetches history) *plus* the SSE
replay (delivers frames emitted while the tab was closed).

## What doesn't exist yet (v2)

- Daemon-backed attach via `DaemonAgentConnection` (currently `InProcessAgentConnection`).
- Workspace file tree + reads.
- Persisted pending dialogs across server restart.
- Multi-user auth (everything binds to `127.0.0.1`, no tokens).
- `Settings` PATCH → `SettingsManager` write-through. Currently a no-op stub.
- `/api/chat/providers|resources|commands|models/discover|workspace/tree` are
  empty stubs (UI hooks expect them); they echo a valid but empty response shape.

## Verified facts (round 2)

- `createAgentSession()` is the canonical entry point. It takes a `uiContext`
  through `bindExtensions({uiContext})` — no separate connection object.
- `AgentSessionEvent`s are emitted via `session.subscribe(handler)`; there is
  no `InProcessAgentConnection` class (that was a fleet-pi abstraction).
- `SessionManager.listAll()` enumerates `~/.prime/agent/sessions/**/*.jsonl`.
- `SettingsManager` owns persistence for `defaultModel` / `defaultProvider` /
  `defaultThinkingLevel`. Not yet wired to `/api/chat/settings` PATCH.
- `IpythonKernelProvisioner.ensure()` is per-`cwd`. Prime-bridge caches it
  once per process (one kernel per Node process in v1).
