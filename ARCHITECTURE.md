# Fleet Prime Architecture

## Purpose

Fleet Prime is Qredence's product/interface layer over a checksum-pinned stock Prime Agent runtime.

Fleet owns:

- the browser product;
- Fleet's server adapter;
- browser-safe transport contracts;
- Fleet presentation/design;
- launcher/distribution.

Prime Agent owns the execution engine.

## System overview

~~~text
Browser
   │
   │ HTTP + NDJSON + SSE
   ▼
web/app
   │
   │ shared web/protocol contracts and server-side route delegation
   ▼
web/server
   │
   │ supported Prime Agent connection / daemon API
   ▼
Pinned stock Prime Agent runtime
~~~

Additional product pieces:

~~~text
web/design
   ↑ reusable UI/presentation used by web/app

packages/fleet-web
   → Fleet launcher/distribution
~~~

The browser never receives upstream runtime objects. TanStack Start route modules in `web/app` delegate server work to `web/server`; browser modules communicate through the HTTP and stream protocol.

## Package ownership

### `web/app`

Owns the TanStack Start browser product, browser state, routes, client behavior, and product composition.

It consumes Fleet browser-safe contracts. Server-only route wrappers may depend on `web/server`, but browser code must not import Prime Agent execution-runtime packages.

### `web/server`

Owns the Fleet-to-Prime adapter boundary.

Its responsibilities include:

* Prime Agent connection/runtime access;
* session adaptation;
* HTTP handlers;
* runtime event mapping;
* browser-safe sanitization/presentation;
* replay;
* pending interactions;
* Fleet-managed presentation state;
* compatibility with the pinned runtime.

Prime Agent-specific runtime knowledge should terminate here.

`PrimeBridge` coordinates server sessions, connections, listeners, in-memory replay buffers, dialogs, and Fleet sidecars. Production sessions use the daemon-backed connection; deterministic tests use the in-process connection factory.

### `web/protocol`

Owns browser/server transport types and compatibility vocabulary.

The browser and server should share these types instead of reproducing wire shapes independently.

### `web/design`

Owns reusable presentation/UI elements.

It should not own runtime semantics or Prime Agent integration.

### `packages/fleet-web`

Owns the published Fleet launcher/distribution.

It consumes the pinned stock Prime Agent runtime. It is not an upstream source checkout or runtime fork.

## Runtime boundary

Prime Agent is consumed as an external stock dependency.

`PRIME_AGENT_RUNTIME.json` is the canonical pin for the `prime-agent` release archive. Package manifests, the workspace allow-build list, and the lockfile must remain synchronized with that manifest; the repository runtime check enforces the package, tarball, and lockfile relationship.

Do not hardcode the current runtime version into this document.

Engine-level changes belong upstream. Fleet adapts supported upstream capabilities at the server/product boundary rather than forking or patching the runtime inside this repository.

## Connection model

Fleet uses the supported Prime Agent `AgentConnection` seam. The server asks that connection for session snapshots, messages, state, commands, and event subscriptions, and sends user actions through its commands. `DaemonAgentConnection` owns the local daemon transport, attach/reconnect, snapshot, and daemon protocol compatibility details.

The server keeps runtime-specific lifecycle and mutable objects behind that seam. It may use server-only session-management operations for resume, fork, and cleanup, but those objects do not cross into `web/app` or the browser. Browser-facing state is a typed projection owned by `web/protocol`.

Connection lifecycle hooks and replacement options are used for session invalidation/replacement and re-seeding behavior. The supported connection surface keeps client behavior independent of whether the runtime is daemon-backed or an in-process test double.

Process-local capabilities such as extension callbacks, dialog handlers, kernel handles, and executable tools remain in the server process. They are not represented as browser callbacks or serialized into the wire protocol.

## Request and event flow

~~~text
browser request
→ web/app route/client
→ web/server handler
→ Fleet Prime adapter
→ Prime Agent connection/daemon
→ upstream runtime events
→ Fleet event mapper
→ web/protocol event
→ browser reducer/state
→ presentation
~~~

`PrimeBridge` is the server-side coordinator in this flow. It maps upstream events to browser-safe frames, dispatches them to active listeners, and places reconnectable out-of-turn frames in the session replay buffer.

## Transport

Fleet has two complementary stream paths:

* an active turn is submitted and streamed as NDJSON; its start, deltas, tool/lifecycle frames, completion, and errors are authoritative for that request;
* SSE carries out-of-turn events, connection state, pending interactions, presentation updates, and replay for a visible session.

SSE clients provide a stream generation and sequence cursor through the supported resume parameters, using `Last-Event-ID` or its equivalent resume query. The server registers the listener before bootstrapping state, replays frames newer than the cursor when they remain available, and emits an explicit resync state when the cursor has fallen outside the in-memory buffer. The browser then hydrates the session and reconnects.

Replay buffers and pending dialog registries are process-local. Session transcripts and validated Fleet sidecars are persisted separately. A process restart therefore cannot promise replay of every missed live event; clients must use hydration/resync semantics.

The durable browser/server contract, including ordering and cursor behavior, is in `docs/reference/adapter-contract.md`.

## Presentation and privacy boundary

Fleet maps runtime information into browser-safe presentation. The event mapper recursively sanitizes sensitive payload keys and converts supported lifecycle signals into controlled status/reasoning summaries.

Raw detailed model reasoning is not a standard Fleet browser data surface. It must not become a live stream frame, hydrated transcript part, assistant-text fallback, copied/exported content, or ordinary diagnostic. Controlled execution/reasoning presentation is derived from safe typed lifecycle information rather than raw hidden reasoning text.

Server-side mapping and sanitization own this boundary. The browser consumes protocol data, not runtime objects.

## Session ownership

Prime Agent owns the runtime session, transcript, model/provider state, queue, and daemon lifecycle.

Fleet owns the product association and server-side presentation layers. These include process-local bridge listeners, replay buffers, pending interactions, and connection state, plus validated persisted presentation sidecars for artifacts, RLM/user-bash/refinement state, and explicit Plan-mode presentations.

Hydration loads upstream messages and Fleet sidecars separately. Plan presentations are keyed to assistant message identity and are joined to browser messages without being rewritten as upstream transcript/runtime state. Sidecars are removed or re-keyed through the corresponding session deletion and fork flows.

## Configuration and credentials

Fleet product configuration owns project/session presentation and server behavior. Prime Agent owns runtime/provider configuration and execution semantics. Environment credentials are consumed only by the server/runtime process.

Browser-visible settings are an explicit, sanitized projection. A secret must not cross into browser state merely because the server or runtime can access it.

## Dependency direction

The intended workspace direction is:

~~~text
web/app ───────────────→ web/design ─────→ web/protocol
  │
  ├──────────────→ web/protocol
  │
  └─server-only route delegation─→ web/server ──→ web/protocol
                                      │
                                      ▼
                          Prime Agent supported runtime/daemon API
~~~

`packages/fleet-web` is the launcher/distribution boundary and consumes the stock runtime and packaged Fleet output.

Prohibited directions:

* browser code in `web/app` or `web/design` must not import `prime-agent`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, or equivalent execution-runtime packages;
* runtime-specific implementation must remain in `web/server`;
* shared browser/server wire types belong in `web/protocol`;
* Fleet must not add an upstream Prime Agent source tree or duplicate daemon/core runtime behavior.

## Architectural invariants

* Fleet does not vendor or patch Prime Agent.
* Prime Agent is the upstream execution engine; Fleet is the product/interface layer.
* `web/server` is Fleet's Prime Agent adapter.
* Browser packages do not import the execution runtime.
* `web/protocol` owns browser/server transport shapes.
* Stock-runtime references remain aligned with `PRIME_AGENT_RUNTIME.json`.
* Runtime-specific mutable objects and executable callbacks do not cross the browser boundary.
* Raw detailed reasoning is not standard browser transcript data.
* Typed runtime signals are preferred over inference from generated text.
* Optional protocol behavior uses explicit capability/version semantics when compatibility requires it.
* Replay/resync guarantees match the actual server state lifetime.
* Fleet-managed sidecars/presentation state must not pretend to be upstream transcript/runtime state.

## Validation architecture

Architectural correctness is protected through:

* TypeScript;
* Biome;
* runtime-manifest verification;
* the browser/runtime import-boundary check;
* deterministic Vitest tests;
* rendering checks;
* package/installer checks;
* release checks.

Code, types, tests, manifests, and executable checks remain authoritative when this document and implementation diverge.
