# Fleet Adapter Contract v1 — Audited Baseline

**Status:** **Implemented baseline — `reasoning-summary-v1`.** Fleet Prime is an independent UI/product layer over the external, TUI-first [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) runtime. This contract belongs to Fleet Prime; it does not require upstream UI ownership or a fork of Prime Agent.

## Implemented scope and validation

The first vertical slice is implemented across the protocol, server bridge, browser reducer, transcript utilities, and existing assistant-turn activity slot. The existing Fleet layout remains unchanged. The `POST /api/chat` start frame now advertises `adapterCapabilities` with `reasoning-summary-v1`. The server maps upstream lifecycle signals and `thinking_delta` into controlled `reasoning` events, while raw detailed thinking is excluded from live frames, final transcript messages, cold hydration, copy, and Markdown transcript export.

The browser records a Fleet-only `tool-FleetReasoning` presentation part only when the advertised capability is present. Its Assistant UI Elements–inspired `FleetReasoningPanel` wrapper renders the controlled timeline inside the existing assistant activity slot. Legacy `thinking` frames and legacy `tool-Thinking` parts are ignored/sanitized rather than rendered. The final message carries the safe presentation through terminal reconciliation.

| Validation command | Result |
|---|---|
| `pnpm typecheck` in `web/` | Passed across protocol, design, server, and app workspaces. |
| `pnpm --filter @prime-agent/web-server test -- src/__tests__/event-mapper.test.ts` | Passed: 19 files / 133 tests, including controlled reasoning and cold-hydration regression coverage. |
| `pnpm --filter @prime-agent/web test -- src/lib/pi/chat-stream-state.test.ts` | Passed: 12 files / 51 tests, including capability fallback and terminal sanitization coverage. |
| `pnpm check:rendering` in `web/` | Passed message-identity and OpenUI contract/render checks. |
| `git diff --check` | Passed with no whitespace errors. |

No destructive or live-agent action was used for validation. A separately configured-model smoke test remains a recommended release gate after the local branch is run in the intended Fleet environment.

## Boundary

Fleet browser code consumes only `web/protocol` contracts over the existing NDJSON turn stream and SSE replay stream. `web/server` owns all Prime Agent imports, session attachment, event mapping, local project association, pending UI dialogs, and replay buffers. No `web/app` or `web/design` component may import Prime Agent runtime classes or infer execution state from raw internal text.[1]

## Compatibility identity and versioning

| Field | v1 rule |
|---|---|
| Fleet adapter protocol version | `1` |
| Schema revision | `1` |
| Upstream identity | `PrimeIntellect-ai/prime-agent` plus the Fleet workspace’s pinned package/repository revision. |
| Feature negotiation | Optional features are advertised as `adapterCapabilities` in the initial `start` frame of `POST /api/chat` and in the `connected` frame of the SSE channel; the field is absent for older adapters. |
| Evolution rule | New behavior is optional/capability-gated. Existing transport and event frames remain valid. |
| Client fallback | Missing or malformed optional capability data disables only the corresponding enhancement. |

The current `POST /api/chat` stream already has an initial `start` frame, so that frame is the compatibility handshake for v1 and the SSE `connected` frame re-advertises it on reconnect (the POST `start` frame is never ring-buffered). A separate endpoint is unnecessary for the first capability because browser clients receive it before any live agent events.[2]

### Runtime baseline: upstream 0.8.0

Fleet Prime tracks upstream `PrimeIntellect-ai/prime-agent` at **v0.8.0** (daemon protocol 8, schema revision 23 including the fork-only `seed_messages` capability). Notes for adapter behavior at this baseline:

- Sessions attach in-process (`createAgentSessionFromServices`), so daemon wire revisions do not constrain `web/server`; the fork's `seed_messages` daemon capability is exercised only by CLI/daemon clients.
- Unknown upstream session events remain silently ignored by the mapper with a compile-time exhaustiveness tripwire; 0.8.0 added refinement transcript messages (`refinement_outcome` custom type), which hydrate as generic assistant messages until a dedicated presentation is specified.
- Upstream 0.8.0 made generic MCP OAuth credentials endpoint-bound: credentials stored before the upgrade require one re-login (`/mcp login <server>`). The mapper rewrites the runtime's binding error into re-login guidance on the surfaces that carry it (retry start/end and compaction-end error messages); `auth_stale` keeps its fixed re-login prompt.
- MCP catalog-name overrides were removed upstream: an `mcpServers` entry named after a built-in integration now disables that built-in instead of repointing it.

## Current event mapping ledger

| Upstream/runtime event | Current Fleet frame | Browser-visible behavior | v1 disposition |
|---|---|---|---|
| `agent_start` | `state.agent_start` | Generic “Working” state; new run ID initialized. | Retain; derive safe reasoning phase. |
| `turn_start` / `turn_end` | `state` | Generic status. | Retain; map to safe reasoning phase/settlement. |
| Assistant `text_delta` | `delta` | Streamed assistant text. | Retain without change. |
| Assistant `thinking_delta` | `thinking` | Raw detailed thought is materialized into `tool-Thinking` and may become final assistant text. | **Suppress from standard browser transcript; replace with `reasoning` summary event.** |
| Tool start/update/end | `tool` | Tool card states, but no normalized purpose/scope/group semantics. | Retain; future `tool-metadata-v1` and `parallel-tool-groups-v1`. |
| `session_action_update` | `queue` | Raw string steer/follow-up queue. | Retain; future typed queue presentation. |
| Compaction start/end | `compaction` | One status string. | Retain; future typed retry/compaction presentation. |
| Retry start/end | `retry` | One status string. | Retain; future typed retry presentation. |
| Plan state | `plan` | Plan label/state. | Retain; future `plan-presentation-v1`. |
| `auth_stale` | `error` | Terminal provider-auth error. | Retain. |
| Extension dialogs | `tool-Question` | Existing question/approval UI. | Retain; future typed approval metadata. |
| RLM child / goal / recap updates | Suppressed | No stable UI representation. | Deferred until stable parent/child semantics are available. |
| `agent_end` | `state.agent_settled` + `done` | Transcript finalization and stream closure. | Retain; emit final safe reasoning presentation before done when feature is negotiated. |

## Replay and ordering baseline

The bridge places every dispatched frame in a per-session in-memory ring buffer with monotonically increasing integer `seq`. SSE clients reconnect with `Last-Event-ID`; the server replays frames strictly greater than that value. If the ring buffer overflowed, the SSE handler emits `state.agent_settled` with `resync-required`, and the client must rehydrate the session.[3] [4]

| Property | Current guarantee | v1 decision |
|---|---|---|
| Live sequence | Per-session, in-memory integer sequence assigned by ring buffer. | Reuse for SSE; do not claim cross-restart durability. |
| Replay ordering | Strictly increasing retained sequence. | Preserve. |
| Overflow | Best-effort replay plus explicit resync signal. | Preserve; add no misleading cursor guarantee. |
| HTTP turn stream | NDJSON frames, no durable sequence envelope. | Keep unchanged for reasoning v1; defer unified event ID/cursor until server can honor it across paths. |
| Deduplication | Reducers use message/tool identity, but no universal event ID. | Defer universal event ID; test reasoning events as idempotent replacement by run/message identity. |
| Session reset | Existing `start`/`done` optional field and rehydrate behavior. | Preserve. |

## Privacy audit and v1 policy

| Exposure route | Current behavior | v1 policy |
|---|---|---|
| Live `thinking` frame | Browser reducer adds raw text to a `tool-Thinking` transcript part. | Server omits raw frame for standard protocol; emits controlled summary only. |
| Agent finalization | Server builds a `tool-Thinking` part then promotes it to text if there is no answer. | Server drops raw thinking from final message; no thought-to-answer promotion. |
| Cold hydration | Transcript mapper converts upstream thinking blocks to `tool-Thinking`, then promotes them. | Convert no raw thinking to user-visible parts; show only actual assistant text/tools. |
| Client completion | Browser promotes thinking-only part to assistant text. | Remove promotion; final message remains empty/tool-only if runtime emitted no answer. |
| Copy | Local slash action falls back to raw thinking. | Copy text only; if no assistant text exists, report no copyable response. |
| Transcript export/share | Local markdown helper falls back to raw thinking. | Export assistant text only; retain tool visibility only under separately approved policy. |
| Diagnostics | Raw source currently reaches ordinary flow. | Any future raw diagnostic trace is a restricted, explicit local-developer feature, not a transcript part. |

> **v1 safety invariant:** Raw detailed reasoning must not be emitted in the standard browser event stream, stored in standard message parts, promoted to assistant text, copied, exported, or rendered by default.

## v1 feature: `reasoning-summary-v1`

The server advertises `reasoning-summary-v1` in the initial turn `start` frame. When the capability is present, the mapper sends small controlled `reasoning` presentations derived from lifecycle events; it never forwards `thinking_delta` text.

```ts
export type ChatReasoningPresentation = {
  runId: string
  messageId?: string
  phase:
    | "waiting"
    | "context"
    | "planning"
    | "executing"
    | "responding"
    | "recovering"
    | "complete"
    | "error"
  steps: Array<{ id: string; title: string; body: string }>
  visibleSteps: number
  streaming: boolean
  startedAt: number
  elapsedMs?: number
  restingLabel: string
}
```

The initial controlled vocabulary is **Preparing run**, **Reviewing workspace context**, **Planning next step**, **Running selected tools**, **Writing response**, **Recovering after retry**, and **Completed**. It is intentionally unable to contain raw model thought text.

## Durable Plan presentation: `plan-presentation-v1`

Fleet now persists a browser-safe Plan presentation record in a Fleet-managed sidecar associated with the Prime session, rather than altering upstream transcript history. The record is created **only** on completion of a Plan-mode turn and contains the canonical hydrated assistant message ID plus the existing typed `ChatPlanState`: ordered visible todos, completion state, execution state, and pending-decision state. That snapshot is derived from the final plan-mode assistant message via the plan-state parser — a bounded heuristic over that single message (numbered, titled, or plain-line checklists). Output from any other turn, however plan-like, can never create a record.

On session load and resume, Fleet validates the record, reconstructs exactly one typed `tool-PlanWrite` part for the associated assistant message, and retains the normal text transcript as a legacy fallback. Execute and Refine update the same controlled presentation snapshot before their existing local Fleet transition runs. Session deletion removes the sidecar.

> **Hierarchy boundary:** v1 `TodoItem` intentionally represents one flat ordered checklist. The official Agent Plan element accepts only `steps: string[]` and a single active cursor. Nested Markdown numbering or indentation is not converted into a fabricated parent/child relationship; it is excluded from the card rather than rendered misleadingly.

A future `plan-hierarchy-v1` contract would require explicit stable item IDs, optional `parentItemId`, sibling display order, completion semantics for parent and child items, and a typed decision/action scope. Fleet must not infer hierarchy from indentation, timestamps, or text prefixes alone.

| Requirement | Enforcement |
|---|---|
| Provenance | Only the completed plan-mode turn writes a record, derived from its final assistant message; plain Agent-mode text cannot create one. |
| Browser safety | The record contains controlled plan fields only; it cannot contain raw reasoning or provider diagnostics. |
| Hydration identity | The server canonicalizes the message ID against the session’s hydrated assistant messages. |
| Decision continuity | Local Execute/Stay/Refine actions update the typed PlanWrite presentation and persist the changed pending/execution state. |
| Legacy compatibility | Sessions with no record remain text-only and cannot be falsely classified as plans. |

## Component readiness gates

| Assistant UI Element family | Current Fleet decision | Required condition before implementation |
|---|---|---|
| Error State | Deferred | A real retry callback, retrying state, and sanitized failure classification. |
| Stopped Run | Deferred | Durable stopped-run reason plus real continue/discard semantics. |
| Guardrail Notice | Deferred | A controlled refusal/blocked contract with safe policy identifier, explanation, and alternatives. |
| Agent Status | Deferred | A callback-capable official API or a truthful wrapper that does not expose dead Pause/Run-again controls. |
| Message Actions | Deferred | Real regenerate and more-action callbacks in addition to existing copy/feedback state. |
| Feedback Dialog | Deferred | A durable Fleet feedback destination; the official submitted copy must not imply model tuning when no persistence exists. |
| Detailed tool presenters | Deferred | `tool-metadata-v1` and `parallel-tool-groups-v1`, as specified below. |
| OpenUI structured output | Preserved | Existing validated OpenUI route remains primary for current generated tables, charts, diagrams, comparisons, and timelines. |

### Proposed `tool-metadata-v1`

Each browser-safe tool operation must carry a stable `operationId`, optional `parentOperationId`, optional `parallelGroupId`, normalized `kind`, controlled `purpose` and `targetSummary`, `status`, `attempt`, safe timing fields, `visibleResultKind`, optional sanitized `errorSummary`, and `retryable`. Terminal text, diff hunks, paths, and result fragments are separate browser-safe references and must not be transported by default merely because the TUI saw them.

### Proposed `parallel-tool-groups-v1`

Groups require an explicit stable group ID, parent run identity, declared member operation IDs, group status, and a display order. Fleet must never infer parallelism from overlapping timestamps or adjacent tool events.

## Future capability backlog

| Capability | Prerequisite | Safe fallback |
|---|---|---|
| `tool-metadata-v1` | Authoritative purpose, target, scope, impact, and retry metadata. | Existing tool cards. |
| `parallel-tool-groups-v1` | Explicit bridge/runtime group ID; never timestamp inference. | Individual activity/tool rows. |
| `queue-presentation-v1` | Stable queue-item IDs/positions. | Existing raw queue strings. |
| `retry-compaction-v1` | Typed state/status metadata. | Existing labels. |
| `recovery-cursor-v1` | Durable cursor and replay semantics across reconnect/restart. | Current in-memory SSE replay/resync. |
| `child-run-presentation-v1` | Stable parent/child lifecycle fields from bridge/upstream. | No fabricated subagent UI. |

## Validation requirements

Mapper tests must prove the summary events are deterministic and raw `thinking_delta` content cannot appear in a default message/frame. Protocol tests must accept old frames and validate new optional frames. Client tests must prove raw thinking is neither stored nor promoted, and copy/export tests must confirm text-only behavior. A live configured-model smoke test remains non-destructive and must validate only safe high-level streaming behavior.

## References

[1]: https://github.com/Qredence/fleet-prime-agent/blob/main/AGENTS.md "Fleet web/runtime boundary"
[2]: https://github.com/Qredence/fleet-prime-agent/blob/main/web/server/src/handlers/chat.ts "NDJSON start frame"
[3]: https://github.com/Qredence/fleet-prime-agent/blob/main/web/server/src/ring-buffer.ts "Per-session replay ring buffer"
[4]: https://github.com/Qredence/fleet-prime-agent/blob/main/web/server/src/handlers/chat-events.ts "SSE replay and overflow behavior"
