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

RLM child records carry the runtime's optional child progress signals as they appear on `rlm_child_update` snapshots: `progressNote` (the latest `rlm.progress.note`) and `activityStaleMs`. The standalone `rlm_progress_note` event has no browser projection because the parent already folds it into the child snapshot. Hidden custom messages (`display: false`, such as the in-context `harness_digest` delivered at fork and resume boundaries) are never rendered.

## Privacy

Runtime-provided detailed reasoning is exposed in dedicated typed reasoning events and transcript parts, separate from assistant answer text. It is not added to ordinary copy/export, unrelated payloads, or diagnostics. Fleet does not fabricate reasoning when the runtime does not provide it, and does not maintain a separate reasoning store.

The server event mapper converts supported typed lifecycle signals into controlled status summaries and recursively sanitizes unrelated payload fields. Legacy thinking shapes remain separate from the explicit reasoning representation.

## Implemented presentation capabilities

### `reasoning-summary-v1`

When the adapter advertises `reasoning-summary-v1`, the server may emit controlled phase labels derived from typed runtime lifecycle events. The browser renders these labels only when the capability is present.

Without the capability, the browser falls back to its baseline status behavior. This feature does not authorize arbitrary text-based execution claims; detailed reasoning uses its own typed representation.

Other event categories are part of the current baseline protocol unless they are explicitly gated by a future capability. Do not add a capability name for an implementation detail that has no compatibility or fallback meaning.

Baseline presentation fields stay forward-tolerant: the browser ignores unknown optional presentation fields, and the server tolerates absent ones. A newer daemon schema revision that only adds optional fields (for example usage summaries) requires no protocol change.

### `composer-intent-v1`

When the adapter advertises `composer-intent-v1`, `POST /api/chat/intent` routes a composer draft to a built-in command. It is optional and off by default: it requires a server-side TypeSafe API key *and* an explicit opt-in in Settings → Chat.

The endpoint returns a decision and nothing else — a command id, a disposition, a confidence, and a coarse reason. It never returns model prose, question instructions, probabilities, or transport error text. `GET`/`PATCH` on the same path read and write the Settings choice and report only a boolean and a coarse status (`unconfigured` | `unverified` | `ready` | `error`); the key itself is never returned, logged, or included in a response envelope.

Falling through is the default and the common case. An absent key, a disabled toggle, a draft shorter than four characters, a leading `/`, a transport failure, a timeout, a rate limit, an unreadable response, or a decision below the confidence floor all produce `outcome: "none"`, and the browser sends the draft to the agent exactly as it would have without this capability.

The execute band does change what Enter does, and that is the point of it: for an id in the shared `composer-intent` catalog marked `autoExecutable`, and for a match above the execute gate in a draft with more than one token, submitting runs the command instead of sending the message. Two limits bound that. A single-token draft is offered but never run automatically, however confident the match, because that is the regime where the model is confidently wrong. Escape on the command ghost is the per-draft override: it dismisses the offer and suppresses execute for that normalized draft until the draft changes, so Enter sends the prose instead. Turning the capability off in Settings still clears every cached decision.

Third-party inference: when the capability is enabled, composer drafts are sent to a hosted classification service. The state sent is code-owned (the draft plus a fixed catalog). The request authenticates with the server-side API key in its `Authorization` header and carries no browser or user credentials. Because drafts are user text that can contain anything, this is why the feature is off by default and why the Settings row states the trade plainly.

### `composer-completion-v1`

When the adapter advertises `composer-completion-v1`, `POST /api/chat/completion` returns ghost text for a composer draft: a **verbatim** string the developer already wrote, which the browser paints dimmed after the caret and Tab accepts. It is local-only and always on — no key, no opt-in, and no data leaves the machine.

A prompt from the session being typed in wins outright over the cross-session corpus, which only supplies a suggestion when this session has nothing matching — so a session's own vocabulary is preferred, and a session with no history of its own falls back to the cross-session corpus exactly as it always has. How much of the suggestion is offered follows how far the matching candidates agree with each other: nothing below a floor, only the part every candidate agrees on in the middle, and — for the **session** tier only — the whole continuation above the extend gate. The corpus tier never extends: it always stops at the agreed prefix, so a contested cross-session field shortens rather than committing to another project's guess. A session-tier suggestion lengthens on its own as typing narrows the candidates.

A completion is never generated. The server prefix-matches the draft against an index of the developer's own earlier prompts, so the offered text always begins with exactly what was typed and can never contradict it. Within this endpoint that remains the property that makes Tab safe to press, and it is the reason this capability uses no model: a System One model returns typed judgments rather than prose, and measured against this task it added nothing over plain matching (choosing between ambiguous near-duplicate history candidates scored the same as "most recent"). The one place a model does measurably help — recognising a mistyped command token — is covered by the intent router above.

The composer's Tab has one case this endpoint does not produce, and it comes from the intent router above: a recognised command is offered through the same inline surface as a **replacement**, which by definition does not extend what was typed. The ghost is painted separated from the draft so the two do not run together, and accepting sets the composer to the command — it does not run it. Nothing in either case executes on Tab; Enter is still the only thing that submits or runs.

**Derived local state.** The corpus is built from the runtime's session store through supported seams only: `listSessions()` for enumeration and the read-only `readLegacySession(...).entries` (`web/server/src/legacy/prime-agent-sdk.ts`, the runtime's own parser, never writing the file) for reads. Entries rather than `buildSessionContext().messages`, deliberately: a context is what the *model* is shown — the branch leading to the current leaf, with everything before a compaction's summary boundary collapsed into that summary — while a prompt is something the person wrote, and it does not stop being one because the conversation was compacted or the branch was abandoned. The context read saw 522 prompts on a store that holds 682. Transcript files are never parsed directly. Only user-authored text is retained: entries carry their own roles, so assistant output, tool results, bash output and compaction summaries are excluded without a special case. The one exception is the runtime's machine-injected bracket grammar (`[autonomous-continuation]`, `[agent-message from …]`, `[heartbeat: …]`, and siblings): autonomous continuations are persisted on the `user` role, so those headers are filtered explicitly. The result is Fleet-owned derived state written beside the runtime's files (`fleet-prompt-index.json` in the agent dir), never inside them, and it is refreshed incrementally in the background so no request ever waits on a build.

Because this reads prompts written in other projects on the same machine, a draft in one project can be completed from a prompt typed in another. That is intended, it stays local, and it is documented here rather than left implicit.

## Fleet-managed presentation state

Fleet persists presentation sidecars separately from the upstream transcript:

* the general session presentation sidecar stores validated Fleet state such as artifacts, RLM/user-bash output, and refinements;
* the plan presentation sidecar stores validated explicit Plan-mode presentations keyed to an assistant message identity.

The server validates sidecars against shared schemas before writing them. Hydration returns them as separate fields and the browser joins plan presentations to the corresponding message. Session deletion removes associated sidecars; fork flows copy or re-key only valid Fleet-owned records.

These records are Fleet presentation state. They are not upstream Prime Agent transcript entries or runtime state.

## Ordering and replay guarantees

* Events from one server-side session stream are dispatched and replayed in sequence order.
* A cursor only applies to the stream generation from which it was obtained.
* Replay covers only retained in-memory SSE frames; it does not cover every runtime event or an entire transcript.
* Active-turn NDJSON ordering is the order of the submitted request's response.
* Process restart and buffer overflow are expected loss boundaries, followed by hydration/resync.
* The browser deduplicates/reconciles by session and event cursor; it must not assume that a reconnect can replay an unbounded history.
* Pending dialogs and other process-local interaction state are not durable merely because their protocol shape can be serialized.

The implementation must not advertise stronger replay, ordering, or durability guarantees than these.

## OpenUI tool surface

Generated OpenUI programs may read Fleet data through `Query(...)`. The renderer
resolves that through `web/app/src/components/openui/openui-tools.ts`, which
posts `{ name, args }` to `/api/chat/openui/tool`; `web/server/src/handlers/openui-tool.ts`
dispatches to the same server handlers the UI uses.

Durable rules:

- The surface is **read-only**. There is no `Mutation` tool and no write path.
  The browser must not gain a write capability through generated UI.
- Tool names, argument schemas, and row field names are owned by
  `web/protocol/src/openui-tools.ts`. Row field names are prompt text: a
  generated table that invents column keys renders placeholders, so keep the
  descriptors accurate when a handler payload changes.
- Tool arguments are untrusted model output and are schema-validated before
  dispatch; workspace paths reject absolute paths, `..`, and backslashes.
- `web/app` carries no runtime knowledge: the route delegates to `web/server`.

### Session outputs source

`session_outputs` is the one tool that reads Fleet's own conversation rather than runtime
state. It returns `{ turn, role, kind, toolName, preview }` rows for the open session and
is scoped to a session the caller already has access to. Detailed reasoning and internal
lifecycle payloads stay out of the rows. `preview` is a bounded plain-text projection and
may include a truncated slice of tool output. This is what lets a generated dashboard
summarize a session without gaining a broader read surface.

## Generative UI dashboards

Dashboards use `@openuidev/dashboard-library`. The mode is resolved on the server from
whether a Thesys key is configured, and a board keeps the mode that created it.

- **No key.** The assistant writes a dashboard-library program in the message. When the
  message finishes, Fleet stores that program. The Dashboards tab draws it with the local
  renderer. There is no Cloud call.
- **Key configured.** When the assistant message finishes, the server calls OpenUI Cloud
  `create` or `edit` once per settlement. An edit that is still generating returns 409, and
  that call is retried within a bounded budget. The Dashboards tab draws the stored opaque response with
  `LiveArtifactRenderer` open. Data queries run through `POST /api/chat/dashboards/interpreter`,
  including the dashboard id so two boards in one session do not share one dataset.
  The browser gets a short-lived frontend token from `POST /api/chat/dashboards/token`.

Durable rules:

- The API key is server-only. `GET /api/chat/dashboards` returns `{ configured, keySource,
  mode, model, modelSource }`; the key is never returned, logged, echoed, or sent to the
  browser. A Settings write is write-only, and clearing it falls back to the server
  environment. The environment name is `THESYS_API_KEY`.
- Reliability Monitoring uses a different key, `VITE_OPENUI_CLIENT_KEY`. It is a browser
  client key (`pk-th-…`) and is read once at the client entry, before an OpenUI response
  renders. It is not returned by the dashboard status projection.
- The model that builds Cloud dashboards is configurable, because a BYOK key covers only
  its own provider. Resolution order is a stored setting, then `FLEET_DASHBOARD_MODEL`,
  then OpenUI's recommended default. The resolved model and its source are reported in
  the status projection; the key never is.
- Prime Agent researches with its normal tools and writes the findings in the reply.
  OpenUI only lays those findings out. `dashboard_rows` serves the figures copied into the
  fence. `session_outputs` is this chat's own activity, and it returns no rows when the
  fence already has figures, so truncated previews cannot replace them. A fence may include
  up to 12 columns and 200 rows. String cells are capped. A number column rejects a
  non-numeric cell. An edit that omits rows keeps the stored rows, including when the
  fence repeats columns without rows. A subject with no stated
  figures and no session activity stays prose.
- The browser does not start generation. The transcript shows one attachment for the first
  dashboard fence in a message. Later fences in that message stay a notice, not another board.
  The attachment opens the Dashboards tab, which lists the session's boards and draws the selected
  one. A board saved by an older version stays stored and shows an error attachment.
- A Cloud create or edit response is opaque. It is stored and handed to the renderer
  verbatim; Fleet extracts the artifact id only to key its own record.
- A Cloud failure on create stores a scrubbed error and no board. A Cloud failure on edit
  stores the scrubbed error and keeps the previous response. Provider text that looks like
  a credential is replaced before it can reach the browser.
- An edit that arrives while the board is still being built is refused with `409`. The
  server retries that transient state within a bounded budget.
- Cloud dashboards are stored as `openui-dashboard` artifacts in the session presentation
  sidecar. They are Fleet presentation state, not upstream transcript entries. A local
  program is stored the same way, with `mode: "local"`, and is not sent to Cloud.
- Assistant text requests a dashboard through one completed `openui-dashboard` fence.
  Without a key the body is `{ title?, program, id?, columns?, rows? }`. With a key the body is
  `{ title?, prompt, id?, columns?, rows? }`. Incomplete fences while streaming are ignored,
  and malformed JSON is dropped. A fence with an `id` and a prompt is a Cloud edit of that
  dashboard. A fence with an `id` and a program updates that local board. A program fence
  without an `id` is a new local board. Fleet reads the Cloud artifact id from `artifact_id`,
  not from the first `art_` token in the response.
- Settling a message is idempotent. Rendering a saved conversation does not call the
  builder again. An edit updates the stored board in place.

## Sources of truth

Use these sources when changing the contract:

- `web/protocol/src/chat-protocol.ts`;
- `web/protocol/src/chat-protocol.zod.ts`;
- `web/protocol/src/schemas/chat.ts`;
- `web/protocol/src/openui-tools.ts`;
- `web/protocol/src/dashboards.ts`;
- `web/server/src/dashboards/`;
- `web/server/src/handlers/dashboards.ts`;
- `web/server/src/event-mapper.ts`;
- `web/server/src/prime-bridge.ts`;
- `web/server/src/handlers/chat.ts`;
- `web/server/src/handlers/chat-events.ts`;
- `web/server/src/ring-buffer.ts`;
- `web/server/src/sse-replay.ts`;
- `web/app/src/components/chat/chat-stream-state.ts`;
- `web/app/src/components/chat/use-pi-chat.ts`.

Relevant deterministic coverage includes the server event-mapper, chat, daemon-runtime, PrimeBridge, SSE replay, and chat-events suites, the dashboard route/service suites, plus the browser stream/reducer, Plan presentation, and dashboard contract tests.

Do not reproduce the full TypeScript unions or schemas here. Update code and tests first, then revise only the durable semantics that changed.
