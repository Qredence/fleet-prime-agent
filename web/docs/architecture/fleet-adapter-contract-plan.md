# Fleet Prime ↔ Prime Agent Adapter Contract Plan

> Historical planning document. The implemented contract and current runtime
> baseline are maintained in
> [`fleet-adapter-contract-v1.md`](./fleet-adapter-contract-v1.md).

## Goal

Define and implement a **Fleet-owned, versioned adapter contract** between the externally maintained, TUI-first Prime Agent runtime and Fleet Prime’s browser product. The contract will convert upstream runtime behavior into stable, browser-safe, user-meaningful presentation events without making Fleet Prime dependent on Prime Agent internals or requiring changes to Prime Agent’s UI.

The first implementation target is a safe vertical slice: **reasoning summaries for the standard transcript**. Subsequent capabilities cover explicit parallel-tool groups, tool/approval metadata, queued work, retries/compaction, recovery/replay, plans, and eventually child-agent/background-run visibility.

> **Ownership boundary:** Prime Agent remains the external runtime. Fleet Prime owns the server bridge, browser protocol, view-model semantics, security/policy decisions, UI rendering, sessions/projects in the Fleet shell, and compatibility management.

## Current baseline

Fleet already separates `web/app` and `web/design` from Prime Agent internals: browser code communicates over HTTP using NDJSON/SSE; `web/server` owns the runtime bridge; and `web/protocol` owns the browser-facing contracts. The current protocol includes `start`, `delta`, `tool`, `plan`, `state`, `queue`, `thinking`, `compaction`, `retry`, `done`, and `error` frames. The current event mapper translates upstream agent/session events to that contract, but some events are suppressed and raw thinking is currently exposed to the normal chat surface.[1] [2] [3]

The adapter must improve semantic coverage without replacing the Fleet layout, session/project model, or existing frontend component structure. It is an integration product, not a fork of the external Prime Agent UI.

## Decisions to lock before implementation

| Decision | Proposed position | Rationale |
|---|---|---|
| Contract ownership | Fleet owns a browser-safe adapter contract in `web/protocol` plus server mappers in `web/server`. | Keeps the UI independent from upstream runtime classes and naming. |
| Versioning | Use a protocol version, schema revision, and explicit feature capability set. | Enables gradual rollout and upstream compatibility management. |
| Wire evolution | Add optional, capability-gated event fields/types; no new mandatory startup behavior. | Older clients/servers continue working with local degradation. |
| Event identity | Every user-visible event carries stable run/session identity; add an ordered cursor/sequence where replay needs it. | Prevents duplicate or reordered UI state during reconnect/replay. |
| Reasoning policy | Standard browser stream carries curated progress summaries, not raw detailed thought text. | Fixes the P0 trust/privacy issue and keeps transcript export/share safe by default. |
| Parallel work | Group only when the runtime/bridge supplies an explicit concurrency group ID. | Avoids incorrect UI grouping based on timing or adjacency. |
| Generated UI | OpenUI actions remain behind Fleet validation and approval policy. | Generated content must not bypass tool, file, project, or permission controls. |
| Upstream strategy | Maintain a tested compatibility matrix by Prime Agent commit/tag; adapt in Fleet bridge rather than changing upstream. | Fleet is independent from the Prime team and must absorb upstream change safely. |

## Phase 1 — Establish the compatibility baseline and exact event inventory

Audit the current adapter surface before any wire change. Read the complete server bridge, event mapper, session manager integration, HTTP handlers, protocol schemas, client stream reducer, replay/hydration paths, and existing tests. Build an event inventory that records every upstream event, its current Fleet mapping, the browser-visible outcome, and whether it is intentionally suppressed or missing.

| Required output | Contents |
|---|---|
| Upstream compatibility matrix | Prime Agent source commit/tag; relevant exported types/events; mapper expectation; test status; supported Fleet capability set. |
| Event mapping ledger | Upstream event → current mapper behavior → target Fleet presentation event → user-visible component. |
| State-machine map | Run, turn, message, tool, approval, queue, plan, recovery, and terminal transitions. |
| Replay assessment | Current cursor/buffer/snapshot behavior; ordering guarantees; duplicate-event risk; session reset behavior. |
| Privacy audit | All paths that can expose thinking, secrets, local paths, tool arguments/results, provider information, or diagnostics. |

**Exit criterion:** The team can point to a single mapping ledger and explain how every existing upstream event is represented, deliberately suppressed, or deferred.

## Phase 2 — Define the Fleet Adapter Contract v1

Create a Fleet-specific protocol document and typed schemas in `web/protocol`. Keep the existing chat transport stable where possible, and introduce a capability discovery response before clients depend on new behavior. The exact route can follow existing server conventions; its design should not be hardcoded until Phase 1 confirms the current handshake model.

### 2.1 Capability negotiation

The server advertises a protocol version, schema revision, upstream compatibility identity, and supported optional capabilities. The client records the advertised set and enables enhancements only when present.

```ts
export type FleetAdapterCapabilities = {
  protocolVersion: number
  schemaRevision: number
  upstream: {
    repository: "PrimeIntellect-ai/prime-agent"
    revision: string
  }
  features: Array<
    | "reasoning-summary-v1"
    | "tool-metadata-v1"
    | "parallel-tool-groups-v1"
    | "queue-presentation-v1"
    | "retry-compaction-v1"
    | "recovery-cursor-v1"
    | "plan-presentation-v1"
    | "child-run-presentation-v1"
  >
}
```

| Client condition | Required behavior |
|---|---|
| Capability advertised | Client may use the enhanced view model and UI element. |
| Capability absent | Client uses current compatible behavior and an honest generic fallback. |
| Capability value malformed | Client ignores the optional enhancement and records a recoverable diagnostic. |
| Incompatible protocol version | Client preserves attachment/session startup where possible and presents a recovery state; it does not crash the chat shell. |

### 2.2 Stable event envelope

Normalize transport frames around a common envelope while retaining the existing discriminated event model. The final design must preserve the current NDJSON/SSE transport and add only optional metadata when compatibility requires it.

```ts
export type FleetAdapterEvent<TType extends string, TPayload> = {
  type: TType
  eventId: string
  sessionId: string
  runId?: string
  cursor?: string
  sequence?: number
  occurredAt?: string
  payload: TPayload
}
```

`eventId` provides idempotency; `cursor` and `sequence` support replay/ordering when Phase 1 confirms the server can offer durable values. Existing fields may remain where changing every client would be wasteful; adapters can construct the normalized model locally.

### 2.3 Browser-safe view models

The server bridge produces structured Fleet presentation data. The browser renders those structures; it does not reconstruct them from raw upstream classes, tool-name heuristics, or detailed thought text.

| View model | Minimum fields | First implementation use |
|---|---|---|
| `TurnPresentation` | run ID, session ID, phase, timestamps, terminal state, recoverability | Waiting, completion, stop, error, reconnect. |
| `ReasoningPresentation` | controlled summary steps, visible count, streaming, elapsed, resting label, optional diagnostic reference | Assistant UI Reasoning Panel. |
| `ToolPresentation` | tool-call ID, kind, title, intent, target, scope, impact, state, result summary, retryability | Existing Fleet tool result/activity cards. |
| `ParallelToolGroupPresentation` | group ID, label, ordered tool-call IDs, expected count, group state | Assistant UI ToolGroup. |
| `ApprovalPresentation` | approval ID, tool call, risk, scope, description, decision, expiry | Existing Fleet ToolApproval/question controls. |
| `QueuePresentation` | item ID, kind, position, editable/cancellable, state | Queue/status surface. |
| `RecoveryPresentation` | connection/replay state, affected run, safe next action | Connection/replay card. |
| `PlanPresentation` | plan mode, decision state, executing flag, steps, current step | Fleet plan/todo surface. |
| `ChildRunPresentation` | child ID, parent ID, status, objective, model, summary | Future subagent/background-work UI. |

## Phase 3 — Deliver the safe reasoning-summary vertical slice

Implement the first vertical slice end-to-end before broadening the contract. This proves version negotiation, structured mapping, browser fallback, policy enforcement, Assistant UI component wrapping, and test discipline with limited scope.

The server must stop putting raw detailed thinking into the default transcript path. Instead, it produces `ReasoningPresentation` state from trusted lifecycle signals such as agent/turn/message state, plan execution, selected tool groups, retry, compaction, and completion. The initial vocabulary remains deliberately controlled: **Preparing run**, **Reviewing workspace context**, **Planning next step**, **Running selected tools**, **Writing response**, **Recovering after retry**, and **Completed**.

The existing assistant-turn activity slot wraps Assistant UI’s `ReasoningPanel` behind a Fleet component. It receives only Fleet summaries, not raw upstream `thinking_delta` text. Older adapters continue showing a generic working state with no detailed trace.

| Work item | Server/contract responsibility | UI responsibility |
|---|---|---|
| Capability | Advertise `reasoning-summary-v1`. | Gate the enhancement by advertised capability. |
| Mapper | Produce safe summary steps and a terminal summary. | Render controlled timeline/elapsed/completion summary. |
| Fallback | Omit enhanced summary if unavailable. | Show generic working status; do not show raw thought. |
| Diagnostics | Retain restricted reference only if policy permits. | Keep diagnostics outside ordinary transcript and behind explicit local setting. |
| Tests | Assert no raw thinking reaches standard presentation event. | Assert no raw thinking appears in default DOM/transcript/export. |

**Exit criterion:** A configured-model non-destructive run displays safe progress and completion summary, with raw thinking absent from standard UI and tests.

## Phase 4 — Add tool, parallel-work, approval, and queue semantics

After the reasoning slice is stable, add tool semantics through a typed adapter rather than the current name-based UI inference. Tool presentation includes purpose, target, local/external scope, impact class, lifecycle state, output summary, and retry behavior only where supported by actual runtime data.

Parallel groups require a server/bridge-generated group identifier. Do not infer concurrency from adjacent frames or timestamps. If the upstream event model cannot identify a concurrent dispatch group, add this metadata only at the Fleet bridge point that schedules work; otherwise retain individual tool cards.

| Capability | Source condition | UI target | Safe fallback |
|---|---|---|---|
| `tool-metadata-v1` | Runtime/bridge can classify tool and scope. | Existing Fleet ToolResult, code, diff, activity. | Present current tool detail without invented purpose/scope. |
| `parallel-tool-groups-v1` | Bridge knows calls were dispatched concurrently. | Assistant UI ToolGroup above existing detailed cards. | Individual activity/result rows. |
| `queue-presentation-v1` | Steering/follow-up queue has stable item IDs/ordering. | Fleet queue in composer/thread. | Current single active-turn behavior. |
| `retry-compaction-v1` | Existing events normalized to user-safe data. | Fleet retry/compaction status cards. | Generic working/error state. |
| `approval-presentation-v1` | Policy/action scope can be supplied. | Existing Fleet ToolApproval/question components. | Do not surface unsupported approval action. |

**Exit criterion:** Users can distinguish proposed, queued, running, completed, failed, cancelled, denied, and expired work without inspecting raw logs; concurrent work is grouped only when explicitly identified.

## Phase 5 — Add recovery, plans, and future child-run capabilities

Implement replay/reconnect only after Phase 1 defines durable ordering and snapshot behavior. Add cursor/sequence support only when the server can honor it across reconnect. Clearly state whether a run continues server-side, has been recovered, needs resync, or has failed.

Plan presentations can be built from the existing plan stream contract, but must distinguish a proposed plan from executed steps and pending user decisions. Child-run/background-job rendering is deferred until the bridge stops suppressing the relevant upstream events and can provide stable parent/child identity and lifecycle state.

| Capability | Required contract evidence | Implementation rule |
|---|---|---|
| `recovery-cursor-v1` | Durable cursor, sequence, replay buffer/snapshot semantics, duplicate handling. | Add a Fleet recovery card and deterministic reducer tests. |
| `plan-presentation-v1` | Mode, pending decision, executing state, step identity, completion state. | Use Fleet plan/todo view models; no inferred completion. |
| `child-run-presentation-v1` | Parent/child IDs, objective, lifecycle, result/error, model metadata. | Prototype Assistant UI subagent/background patterns only after data exists. |

**Exit criterion:** Recovery does not duplicate transcript/tool state; plan state is accurate; deferred child-run UI has an explicit upstream/bridge prerequisite rather than a mock production renderer.

## Phase 6 — Compatibility, security, and release discipline

Pin a compatibility matrix by upstream Prime Agent commit/tag. Every adapter change tests supported combinations and treats new upstream events as data to map, explicitly suppress, or capability-gate. The implementation must obey the repository’s rule that protocol changes are classified as backward-compatible, capability-gated, or incompatible; optional metadata must degrade locally; incompatible changes require the corresponding version/revision and compatibility test updates.[4]

| Test class | Required cases |
|---|---|
| Mapper unit tests | Every upstream event maps deterministically; unknown future events are safe; no raw thinking enters default presentation. |
| Protocol/schema tests | Zod/schema generation; optional field parsing; capability negotiation; malformed optional metadata ignored safely. |
| Compatibility tests | New client/old adapter; old client/new adapter; feature available/unavailable; upstream revision matrix. |
| Replay tests | Duplicate frame, out-of-order frame, gap, snapshot recovery, session reset, tool upsert. |
| UI component tests | Reasoning summary, tool/approval states, queue, recovery, keyboard, ARIA/live regions, reduced motion. |
| End-to-end tests | Deterministic faux provider for normal paths; one non-destructive configured-model smoke test only. |
| Security tests | Raw-thinking exclusion; path containment; safe tool/approval presentation; generated OpenUI action cannot bypass Fleet policy. |

Release each capability behind a local feature flag. Start with development fixtures, then opt-in, then default after compatibility and behavior evidence. Instrument only privacy-respecting operational events such as stream completion, retry/recovery success, queue cancellation, approval outcome, and generated-surface fallback—never raw prompt, raw thought, or unredacted tool output.

## Milestones and deliverables

| Milestone | Deliverable | Approval gate |
|---|---|---|
| M1 | Event mapping ledger and upstream compatibility matrix. | Every current event has a documented disposition. |
| M2 | `Fleet Adapter Contract v1` specification, typed schemas, capability rules, and privacy policy. | Product/engineering agree on semantics and fallbacks. |
| M3 | Safe reasoning-summary vertical slice. | Live non-destructive UX test and raw-thinking regression test pass. |
| M4 | Typed tool/approval/queue contract plus explicit parallel-tool group capability. | Tool lifecycle and group tests pass without inferred concurrency. |
| M5 | Recovery/plan contract and deferred child-run prerequisite decision. | Replay/version compatibility evidence is complete. |
| M6 | Compatibility matrix, fixtures, automated tests, rollout and rollback guide. | Feature-flagged release is reversible and documented. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Upstream Prime Agent changes event shapes. | Pin revisions, test a compatibility matrix, and isolate all adaptation in Fleet server/protocol code. |
| UI needs data the external runtime does not emit. | Do not fabricate; add optional Fleet bridge metadata only where it has authoritative knowledge, or defer the surface. |
| Raw thinking returns via transcript hydration, tool parts, diagnostics, or exports. | Enforce policy at mapping, stored view-model, renderer, and export boundaries; test every route. |
| Parallel groups are inferred incorrectly. | Require explicit runtime/bridge group IDs; fallback to individual cards. |
| Protocol evolution breaks existing local setups. | Capability-gate optional features; retain old behavior; test old/new combinations. |
| Adapter becomes a hidden fork of Prime Agent. | Keep it a thin mapping/normalization layer with no upstream runtime behavior changes or web-specific exports. |

## Assumptions and open points

The plan assumes Fleet retains its present NDJSON/SSE browser transport and that the current server bridge can evolve independently of the external runtime. Phase 1 must confirm current capability/handshake and replay mechanics before finalizing field names or persistence behavior. If a required semantic is unavailable upstream, Fleet will prefer a truthful fallback over guessed UI state.

## References

[1]: https://github.com/Qredence/fleet-prime-agent/blob/main/AGENTS.md "Fleet Prime interface and adapter boundary"
[2]: https://github.com/Qredence/fleet-prime-agent/blob/main/web/protocol/src/chat-protocol.ts "Fleet browser chat protocol"
[3]: https://github.com/Qredence/fleet-prime-agent/blob/main/web/server/src/event-mapper.ts "Fleet Prime event mapper"
[4]: https://github.com/Qredence/fleet-prime-agent/blob/main/AGENTS.md#daemon-protocol-changes "Fleet protocol compatibility rules"
