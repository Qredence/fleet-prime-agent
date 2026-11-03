# Drive only the native Rust Prime Agent daemon

## Status

Accepted. The plan was approved by Zachary on 2026-10-23 (`docs/plans/prime-agent-v0.10.1.md`). The cutover landed in `4e850586b` (2026-10-27, "drive the Fleet connection port and drop the SDK path"), merged with PR #291.

## Context

Upstream Prime Agent v0.10.x replaced the TypeScript daemon with a native Rust binary. The wire protocol stayed at `prime-agent.daemon` protocol 7, schema revision 30, but the Rust daemon differs from v0.9.8 in ways that matter to Fleet:

- it has its own schema id (`protocol-7-schema-30-8e4b17c2a9f5`) and a `runtime.buildId` of `pa-daemon-rs-<version>`;
- `tool_execution_update` and `tool_execution_end` carry no `toolName`;
- the kernel tool is `python_repl`, not `ipython`;
- it adds `session_binding` and `model_catalog_changed` frames;
- it reads `telemetryDisabled` only at the top level of a command;
- it drops the `extension_ui` capability;
- its npm package exports no library types.

Until the cutover, Fleet drove each session through the v0.9.8 SDK's `DaemonClient` and `DaemonAgentConnection`, and the package spawned through the npm launcher. Supporting both daemons would have meant two adapter paths, each with its own session and settings behavior, and the SDK path could not follow upstream past v0.9.8.

## Decision

- Fleet drives only the Rust daemon. `isCompatibleDaemonHello` (`web/server/src/daemon-protocol.ts`) accepts protocol 7, schema revision 30, and the Rust flavor. Any other daemon on the socket, including a v0.9.8 TypeScript daemon speaking the same protocol, is refused with an error naming the mismatch rather than attached to.
- Every session attaches through Fleet's own `FleetDaemonAgentConnection` (`web/server/src/fleet-daemon-connection.ts`). It implements the Fleet connection port (`agent-connection-port.ts`) over Fleet's protocol-7 socket client and Fleet-owned wire types. Fleet owns attach, chunked snapshots, cursor dedupe, reconnect and resync.
- The runtime is the stock upstream release binary, pinned in `PRIME_AGENT_RUNTIME.json` with archive and executable SHA-256 values per target. `ensurePrimeRuntime` installs it after verifying both digests. Fleet spawns it directly (`prime-agent --mode daemon --daemon-socket <socket>`) and never runs the npm migration launcher or the network installer. Fleet does not vendor, build, or patch the runtime.
- The browser contract does not move. `ChatStreamEvent` (zod, `web/protocol`) stays frozen across the cutover. Daemon differences are absorbed in `web/server`, mainly the event mapper (tool names looked up by `toolCallId`, the `python_repl` card, top-level frames consumed silently).

## Contract lock

Recorded fixture sets pin the frozen contract. Each set holds raw daemon frames, plus the `ChatStreamEvent` output Fleet produced from them, under `web/server/src/__tests__/fixtures/daemon-frames/`:

- `v0.9.8/`, recorded before the cutover (PR 0), is the baseline the Rust path had to match;
- `rust-v0.10.1/`, captured live from the Rust daemon (R1), covers the Rust-only shapes;
- each later pin bump adds its own set, starting with `rust-v0.10.2/` in draft PR #320.

`daemon-frame-contract.test.ts` replays every pinned set and compares the output with the expected events. `fleet-adapter-contract.test.ts` replays the Rust sets through `FleetDaemonAgentConnection` and requires identical output. `daemon-frame-sets.test.ts` adds cross-set invariants: schema validity, tool cards reaching a done state with a real name, and no leaks of hidden harness messages. Any change to how a recorded stream maps fails CI.

## Considered options

- **Keep the v0.9.8 SDK connection and pin.** Rejected: it freezes Fleet on a runtime upstream no longer develops, and the SDK cannot drive the Rust daemon.
- **Support both daemons behind one adapter.** Rejected: two session and settings behaviors on the production path, with neither fully tested. The TypeScript daemon is refused instead.
- **Build or patch the Rust runtime in Fleet.** Rejected: Fleet stays a product and interface layer over stock Prime Agent. Missing capabilities are requested upstream.

## Consequences

- Upgrading the runtime means bumping the checksum pin and capturing a fixture set, following `docs/guides/upstream-runtime.md`. A protocol or schema change upstream requires a matching adapter change in the same PR.
- v0.9.8-only surfaces go away: extension UI and question dialogs, recap, `auth_stale`, `extension_error`, and the `ipython` alias. Their removal is tracked in the plan and lands in step with the protocol field removals.
- The remaining SDK imports in `web/server` are confined to the R1b legacy bridge (`legacy/prime-agent-sdk.ts`), the in-process test adapter, the `pi-ai/mcp` built-in MCP catalog, and type-only imports. `scripts/check-web-boundaries.mjs` freezes them against `scripts/server-sdk-imports.baseline.json`. The baseline shrinks to empty and is then deleted together with the v0.9.8 package family and the top-level SDK fields of `PRIME_AGENT_RUNTIME.json`.
- Some features have no supported daemon operation yet: settings edits, provider and MCP OAuth sign-in, and cross-project forks. They show terminal guidance or are unavailable, rather than writing Prime Agent's files from Fleet.
- The `v0.9.8/` fixture set keeps the SDK's `DaemonAgentConnection` in the replay harness as test-only code. When the SDK is removed, that set either moves to a frame-level replay or is retired by a deliberate decision.
