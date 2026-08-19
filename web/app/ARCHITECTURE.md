# Fleet Prime Web Architecture

Standalone Qredence web UI for the Fleet Prime product, backed by the in-tree
coding-agent package (`packages/coding-agent`).
The UI is not merged into `PrimeIntellect-ai/prime-agent`. `web/app` is the
TanStack Start host; `web/server` is the only web package that imports
`@earendil-works/*`. Install the UI with pnpm (`web/`); the inherited CLI
package stays on npm.

## Process boundary

```
browser ─ EventSource/fetch ─▶ TanStack Start (web/app /api routes)
                                   │  thin wrappers
                                   ▼
                         web/server handlers
                                   │
                                   ▼
                              PrimeBridge
                                   │  (1 instance per Node process — singleton.ts)
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

Optional `VITE_FLEET_PI_CHAT_RUNTIME_URL` points the browser at a remote
runtime; handlers are process-agnostic `Request → Response` functions.

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
| GET    | /api/chat/settings         | Resolved settings                             |
| PATCH  | /api/chat/settings         | Persist settings via `SettingsManager`        |
| GET    | /api/chat/providers        | Provider catalog + credentials                |
| GET    | /api/chat/resources        | Skills, prompts, extensions                   |
| GET    | /api/chat/commands         | Slash command autocomplete                    |
| POST   | /api/chat/models/discover  | OCC `/v1/models` probe                        |
| GET    | /api/workspace/tree        | Workspace file tree                           |
| GET    | /api/workspace/file        | File preview                                  |
| GET    | /api/workspace/browse      | Directory picker                              |
| POST   | /api/workspace/root        | Rebind default cwd                            |
| GET    | /api/chat/events           | SSE + ring-buffer replay                      |
| GET    | /api/health                | Liveness + kernel readiness                   |

## Mapper

`web/server/src/event-mapper.ts` is a pure function `AgentSessionEvent →
ChatStreamEvent[]`. Tool names pass through `toPascalCase` with `IPython` and
short-acronym special-casing, producing `tool-IPython | tool-Bash | tool-Edit |
tool-Thinking | …`. All tool parts land on `ChatToolPart.state: input-streaming
→ output-available | output-error`.

## Tool renderers

`web/design/src/components/agent-elements/tools/` dispatches on
`part.type`:

- `tool-IPython` → `ipython-tool.tsx`
- `tool-Bash`, `tool-Edit` → bash/edit cards
- `tool-Thinking`, `tool-TodoWrite`, `tool-PlanWrite`, `tool-Task`, `tool-Agent`,
  `tool-Question`, `tool-WebSearch|Grep|Glob`
- everything else → `GenericTool` from `toolRegistry`

`PI_TOOL_RENDERERS` is an empty table so the chat shell stays type-safe without
forking default renderers.

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

## Gaps

- No daemon-backed attach (`AgentConnection`). Web uses in-process
  `createAgentSession` via the HTTP adapter.
- Pending dialogs are not persisted across server restart.
- No multi-user auth (binds to `127.0.0.1`, no tokens).
