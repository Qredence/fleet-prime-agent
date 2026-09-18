# Fleet Prime Adapter Contract

## Scope

This document defines the browser-safe contract between Fleet's Prime Agent adapter and the Fleet browser product.

The source implementation lives primarily in:

- `web/protocol`;
- `web/server`;
- browser reducer/client code;
- associated deterministic tests.

This document explains durable semantics. Code, schemas, and tests remain authoritative.

## Compatibility

The adapter advertises a protocol version, schema revision, and optional feature names in connection/start metadata. The currently implemented optional feature is `reasoning-summary-v1`.

Clients must ignore unknown feature names and treat absent or unsupported optional features as unavailable. The server keeps baseline event and session behavior usable without an optional feature; the browser uses its fallback presentation.

Compatible additions should add optional fields or event capabilities. A change that alters the meaning, required fields, ordering, or privacy properties of an existing contract requires an explicit protocol/schema version or capability gate.

The adapter contract is independent of the exact Prime Agent release. The stock runtime identity and checksum are pinned by `PRIME_AGENT_RUNTIME.json`; do not duplicate its version here.

## Transport

Fleet uses two stream paths:

* an active turn is submitted and streamed as newline-delimited JSON (NDJSON) through the chat endpoint;
* server-sent events (SSE) carry out-of-turn events, connection metadata, pending interactions, presentation updates, and replay for a session.

The active NDJSON response is authoritative for the submitted turn. It carries the start, deltas, lifecycle/tool frames, completion, and errors for that request. SSE is the session event channel and is not a replacement for the active turn response.

Replayable SSE frames have a monotonically increasing sequence within the current server-side session stream. A reconnect supplies the last received cursor through `Last-Event-ID` or the equivalent resume query, together with the stream generation when available. The server registers the listener before bootstrapping and replays frames newer than the cursor in sequence order.

The replay buffer is bounded and in memory. It is not a durable event log. A process restart, session disposal, buffer clear, generation change, or cursor older than the retained range can make replay unavailable. In those cases the server emits an explicit resync state and the browser rehydrates the session before continuing.

The browser stores its last accepted cursor per session and reconnects its SSE channel. Hydration reads the session snapshot and Fleet sidecars; it does not reconstruct missing runtime events from arbitrary browser text.

## Event mapping

`web/server` maps upstream runtime events into the `web/protocol` vocabulary. Current mapped categories include:

* turn and assistant text lifecycle;
* tool calls/results and pending extension interactions;
* plan and execution state;
* queue and session state;
* compaction and retry lifecycle;
* RLM/child-session and presentation updates;
* controlled reasoning summaries;
* completion, error, and resync state.

The mapper owns the browser-safe projection. Unknown or unsupported upstream details are not automatically promoted into browser events. The protocol types and mapper tests define the accepted shapes.

## Privacy

Raw detailed model reasoning must not be emitted, stored, promoted, copied, exported, or rendered as ordinary browser transcript content.

In particular, detailed thinking must not become:

* a live browser stream payload;
* a standard message part;
* hydrated transcript content;
* an assistant-text fallback;
* copy/export content;
* an ordinary diagnostic.

The server event mapper converts supported typed lifecycle signals into controlled status/reasoning summaries and recursively sanitizes sensitive payload fields before they cross the browser boundary. The browser also ignores legacy detailed-thinking shapes rather than treating them as transcript text.

This guarantee applies to both live and hydrated data. A new presentation must use an approved typed runtime signal and preserve the same browser-safety boundary.

## Implemented presentation capabilities

### `reasoning-summary-v1`

When the adapter advertises `reasoning-summary-v1`, the server may emit controlled phase labels derived from typed runtime lifecycle events. The browser renders these labels only when the capability is present.

Without the capability, the browser falls back to its baseline status behavior. The feature does not authorize raw model reasoning, arbitrary text-based execution claims, or persistence as a normal assistant message.

Other event categories are part of the current baseline protocol unless they are explicitly gated by a future capability. Do not add a capability name for an implementation detail that has no compatibility or fallback meaning.

Baseline presentation fields stay forward-tolerant: the browser ignores unknown optional presentation fields, and the server tolerates absent ones. A newer daemon schema revision that only adds optional fields (for example usage summaries) requires no protocol change.

### `composer-intent-v1`

When the adapter advertises `composer-intent-v1`, `POST /api/chat/intent` routes a composer draft to a built-in command. It is optional and off by default: it requires a server-side TypeSafe API key *and* an explicit opt-in in Settings → Chat.

The endpoint returns a decision and nothing else — a command id, a disposition, a confidence, and a coarse reason. It never returns model prose, question instructions, probabilities, or transport error text. `GET`/`PATCH` on the same path read and write the Settings choice and report only a boolean and a coarse status (`unconfigured` | `unverified` | `ready` | `error`); the key itself is never returned, logged, or included in a response envelope.

Falling through is the default and the common case. An absent key, a disabled toggle, a draft shorter than four characters, a leading `/`, a transport failure, a timeout, a rate limit, an unreadable response, or a decision below the confidence floor all produce `outcome: "none"`, and the browser sends the draft to the agent exactly as it would have without this capability.

The execute band does change what Enter does, and that is the point of it: for an id in the shared `composer-intent` catalog marked `autoExecutable`, and for a match above the execute gate in a draft with more than one token, submitting runs the command instead of sending the message. Two limits bound that. A single-token draft is offered but never run automatically, however confident the match, because that is the regime where the model is confidently wrong. And within the decision cache's TTL, re-typing the same text reaches the same decision — there is no per-draft override, so a user who wants that text sent to the agent rather than routed must change the wording or turn the capability off in Settings.

Third-party inference: when the capability is enabled, composer drafts are sent to a hosted classification service. The state sent is code-owned (the draft plus a fixed catalog) and the request carries no credentials. Because drafts are user text that can contain anything, this is why the feature is off by default and why the Settings row states the trade plainly.

### `composer-completion-v1`

When the adapter advertises `composer-completion-v1`, `POST /api/chat/completion` returns ghost text for a composer draft: a **verbatim** string the developer already wrote, which the browser paints dimmed after the caret and Tab accepts. It is local-only and always on — no key, no opt-in, and no data leaves the machine.

A completion is never generated. The server prefix-matches the draft against an index of the developer's own earlier prompts, so the offered text always begins with exactly what was typed and can never contradict it. That is the property that makes Tab safe to press, and it is the reason this capability uses no model: a System One model returns typed judgments rather than prose, and measured against this task it added nothing over plain matching (choosing between ambiguous near-duplicate history candidates scored the same as "most recent"). The one place a model does measurably help — recognising a mistyped command token — is covered by the intent router above.

**Derived local state.** The corpus is built from the runtime's session store through supported seams only: `listSessions()` for enumeration and `SessionManager.openAsync(...).buildSessionContext().messages` for reads — the same path the bridge uses to load a cold session. Transcript files are never parsed directly. Only user-authored text is retained; assistant output and tool results are never indexed. The result is Fleet-owned derived state written beside the runtime's files (`fleet-prompt-index.json` in the agent dir), never inside them, and it is refreshed incrementally in the background so no request ever waits on a build.

Because this reads prompts written in other projects on the same machine, a draft in one project can be completed from a prompt typed in another. That is intended, it stays local, and it is documented here rather than left implicit.

## Fleet-managed presentation state

Fleet persists presentation sidecars separately from the upstream transcript:

* the general session presentation sidecar stores validated Fleet state such as artifacts, RLM/user-bash output, and refinements;
* the plan presentation sidecar stores validated explicit Plan-mode presentations keyed to an assistant message identity.

The server validates sidecars against shared schemas before writing them. Hydration returns them as separate fields and the browser joins plan presentations to the corresponding message. Session deletion removes associated sidecars; fork flows copy or re-key only valid Fleet-owned records.

These records are Fleet presentation state. They are not upstream Prime Agent transcript entries, runtime state, or evidence that raw reasoning is safe to expose.

## Ordering and replay guarantees

* Events from one server-side session stream are dispatched and replayed in sequence order.
* A cursor only applies to the stream generation from which it was obtained.
* Replay covers only retained in-memory SSE frames; it does not cover every runtime event or an entire transcript.
* Active-turn NDJSON ordering is the order of the submitted request's response.
* Process restart and buffer overflow are expected loss boundaries, followed by hydration/resync.
* The browser deduplicates/reconciles by session and event cursor; it must not assume that a reconnect can replay an unbounded history.
* Pending dialogs and other process-local interaction state are not durable merely because their protocol shape can be serialized.

The implementation must not advertise stronger replay, ordering, or durability guarantees than these.

## Sources of truth

Use these sources when changing the contract:

- `web/protocol/src/chat-protocol.ts`;
- `web/protocol/src/chat-protocol.zod.ts`;
- `web/protocol/src/schemas/chat.ts`;
- `web/server/src/event-mapper.ts`;
- `web/server/src/prime-bridge.ts`;
- `web/server/src/handlers/chat.ts`;
- `web/server/src/handlers/chat-events.ts`;
- `web/server/src/ring-buffer.ts`;
- `web/server/src/sse-replay.ts`;
- `web/app/src/lib/pi/chat-stream-state.ts`;
- `web/app/src/lib/pi/use-pi-chat.ts`.

Relevant deterministic coverage includes the server event-mapper, chat, daemon-runtime, PrimeBridge, SSE replay, and chat-events suites, plus the browser stream/reducer and Plan presentation tests.

Do not reproduce the full TypeScript unions or schemas here. Update code and tests first, then revise only the durable semantics that changed.
