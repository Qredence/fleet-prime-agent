# Session tree and rewind (web) — product proposal

This is a planning artifact, not a runbook. See [docs/README.md](../README.md) for current guides.

Issue: [#124](https://github.com/Qredence/fleet-prime-agent/issues/124)

This document scopes the remaining web/TUI gap for **visual session-tree navigation and rewind-from-history**. It is intentionally a planning artifact, not an implementation checklist for the current slice.

## Goal

Give Fleet web users the same durable session-branch semantics the TUI already has:

- Browse the session entry tree (user/assistant turns and branch points).
- Rewind the live session to an earlier entry (`navigateTree`).
- Fork or clone from a chosen entry into a new live session (`forkSession`).

The web UI must stay on Fleet's adapter boundary. Runtime session objects, `SessionManager`, and raw upstream tree nodes must not leak into `web/app` or `web/design`.

## What already exists

### Server (`web/server`)

| Capability | Location | Notes |
|------------|----------|-------|
| Tree navigation | `PrimeBridge.navigateTree(sessionId, targetId)` | Calls `AgentConnection.navigateTree`; invalidates managed plan presentations after branch change |
| Tree snapshot | `PrimeBridge.getSessionTree(sessionId)` | Returns cached `{ tree, leafId }` from bridge session cache |
| Fork / clone | `PrimeBridge.forkSession(sessionId, entryId, position)` | Creates a **new** live session; source session keeps running |
| Slash bridge | `handleChatCommandPost` `tree` / `fork` / `clone` | `/tree` with args navigates; without args returns tree JSON. `/fork` and `/clone` call `forkSession` |

### Browser (`web/app`)

| Capability | Location | Notes |
|------------|----------|-------|
| Text `/tree` | `use-local-slash-actions.ts` | Prints a text tree via the command API |
| Fork picker | `fork-picker-dialog` + slash actions | `/fork` already has a picker wired to `fork` command |
| Missing | — | No visual tree panel, no rewind-from-history UI, no in-place branch indicator in transcript |

### Protocol (`web/protocol`)

No dedicated tree/rewind wire types yet. Today the browser reaches tree operations through the generic chat-command endpoint and receives opaque `tree` JSON.

## Proposed layering

```text
web/design   visual tree panel, rewind affordances, fork entry picker chrome
     ↓ typed protocol (new)
web/app      hooks + command client; no runtime imports
     ↓ HTTP
web/server   PrimeBridge.navigateTree / getSessionTree / forkSession
     ↓ AgentConnection
stock Prime Agent runtime
```

### Protocol additions (additive)

Introduce browser-safe types in `web/protocol`, for example:

- `SessionTreeNode` — id, parentId, role (`user` | `assistant` | …), label/preview text, child ids (or nested children), `isLeaf`.
- `SessionTreeSnapshot` — `tree`, `leafId`, `sessionId`.
- `SessionTreeNavigateRequest` / `SessionTreeNavigateResponse` — navigate + authoritative snapshot.
- `SessionForkRequest` / `SessionForkResponse` — entry id, position (`before` | `at`), resulting `sessionId`.

Keep shapes stable and presentation-oriented. Do not expose upstream `SessionManager` entry records verbatim.

Capability-gate with something like `session-tree-v1` if older servers must be supported.

### Server handlers

Prefer dedicated handlers (e.g. `GET/POST /api/chat/session-tree`) over overloading chat-command long term:

1. **Read** — `getSessionTree` after ensuring session is resumed.
2. **Navigate** — `navigateTree` with optimistic concurrency guard (reject if session generation changed during pick).
3. **Fork** — existing `forkSession`; return new session metadata for sidebar resume.

Handlers should reuse `requireProjectSession` and the same session-access checks as queue mutations.

### Browser UX slices (ordered)

1. **Read-only tree drawer** — panel listing branch structure; selecting a node highlights the corresponding transcript turn (match by entry id stored in message metadata or a parallel index map).
2. **Rewind** — confirm dialog → `navigateTree` → reload session transcript via existing `loadSession` / SSE replay path.
3. **Fork from node** — reuse fork picker patterns; after fork, `resumeSession` the returned id.
4. **Transcript affordances** — optional per-turn "rewind here" / "fork here" actions once entry ids are available in hydrated messages.

### State and concurrency rules

- **Rewind mutates the active session transcript.** After `navigateTree`, discard stale plan presentations (bridge already invalidates managed plans).
- **Fork creates a sibling session.** Do not replace the active tab silently; follow the same sidebar resume flow as project fork.
- **Queue and stream guards** — block rewind while a turn is streaming unless the runtime supports abort-then-navigate; mirror TUI idle checks (`waitForIdle` on server).
- **Entry id resolution** — transcript hydration must expose stable entry ids for mapping. If current Fleet message ids are positional (`${sessionId}-mN`), plan an explicit mapping layer before building the visual tree.

## Non-goals for the first tree slice

- Cross-session tree search ([#126](https://github.com/Qredence/fleet-prime-agent/issues/126)).
- Export/import of branched sessions ([#129](https://github.com/Qredence/fleet-prime-agent/issues/129)).
- Exposing raw `AgentSession`, `SessionManager`, or mutable runtime handles to the browser.

## Validation plan (when implemented)

- Server unit tests on new handlers (mock `PrimeBridge`).
- Protocol schema tests for tree snapshot shapes.
- Browser tests: open tree panel, rewind on a branched fixture session, fork creates a new sidebar entry.
- Regression: `/tree` slash text output remains available.

## Recommendation

Land [#123](https://github.com/Qredence/fleet-prime-agent/issues/123) queue editing first. Start tree work only after protocol types and entry-id mapping are designed; implement read-only tree + rewind as the first user-visible slice before fork chrome moves into the panel.
