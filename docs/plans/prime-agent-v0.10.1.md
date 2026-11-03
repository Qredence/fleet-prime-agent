# Plan: Prime Agent v0.10.1 (Rust daemon) cutover and frontend cleanup

Status: approved by Zachary on 2026-10-23.
Owners: prime maintain, prime rust, prime ui.

Fleet stays a Web UI for stock Prime Agent. This plan moves the pinned runtime from the
TypeScript v0.9.8 daemon to the native Rust v0.10.1 daemon. It also cleans up the frontend
without changing the product's look.

## Ground rules

- All heavy or local work runs on Zachary's Mac mini under `/Volumes/SSD-T7`. No cloud
  agents.
- Every PR is opened as a draft. Zachary reviews and merges each one himself. Nothing is
  merged or auto-merged by an agent.
- Never print secrets. Never force-push. Do not relax pnpm `minimumReleaseAge`.
- `ChatStreamEvent` (zod, `web/protocol`) stays frozen. `web/app` never imports
  `prime-agent`, only `web/server` does.

## Runtime track

### PR 0: v0.9.8 contract fixtures and replay test (prime maintain)

- Record raw v0.9.8 daemon frames and Fleet's `ChatStreamEvent` output under
  `web/server/src/__tests__/fixtures/daemon-frames/v0.9.8/`. This sits next to R1's
  `daemon-frames/rust-v0.10.1/`.
- Add a generic replay harness over `daemon-frames/<set>/`, with frames going through the
  stock adapter and then the real event mapper. Any contract change fails CI.
- Scenarios: normal turn, tool call, `ipython` call, cancel mid-tool, compaction,
  auto-retry, queued steer, extension-UI round-trip (v0.9.8 baseline only), subagent spawn,
  and tool-update name continuity.
- No production behaviour changes.

### R1: Rust daemon socket client (prime rust)

- Socket client with Fleet-owned protocol-7 types.
- Look up the tool name by `toolCallId` from `tool_execution_start`, because v0.10.1
  `tool_execution_update` and `_end` carry no `toolName`.
- Rename `ipython` to `python_repl`.
- Send `telemetryDisabled` at the top level first, with a test, because v0.10.1 only reads
  the top-level field.
- Handle `session_binding` and `model_catalog_changed`.
- Drop `continueRecent` and `agentDir`.
- Accept `owned` from `cancel_prompt_admission`.
- Use paged session listing.
- Fork through the daemon's `fork` command.
- Add the Rust-recorded fixture set (`daemon-frames/rust-v0.10.1/`): `python_repl`,
  `session_binding`, `model_catalog_changed` and nameless tool frames, replayed by the PR 0
  harness.
- Run one real-model turn on the Mac mini first.

### R1b: narrow legacy bridge (prime maintain)

- Keep the legacy `SettingsManager`, `AuthStorage` and a read-only `SessionManager` as a
  stopgap, since the on-disk format is unchanged. Open an issue to track their removal.
- Delete `IpythonKernelProvisioner`.
- Implementation: `web/server/src/legacy/prime-agent-sdk.ts` is the only server module that
  imports those classes. Its session reader is read-only (unlike `SessionManager.openAsync`,
  which repairs, migrates and truncates files). `scripts/check-web-boundaries.mjs` blocks
  them elsewhere and freezes every other server SDK import in
  `scripts/server-sdk-imports.baseline.json` until R1 removes them. The fork writers and the
  in-process test adapter keep `SessionManager` until R1's daemon fork replaces them.

### Cutover PR (lands with R1)

- Remove the recap, `auth_stale`, `extension_error` and question/dialog surfaces, plus the
  `ipython` alias. These still fire on v0.9.8 today, so they are removed here and not in
  U1.
- Migration in progress: the mapper ignores `recap_update`, `session_status`, `auth_stale`,
  and `extension_error`; recap and questionnaire presentation is retired. Live pending
  questions are skipped, and failures stop the active session with a visible error. The
  `ipython` alias and server-side legacy question mapping still require removal. Existing
  protocol schema and stored sessions are unchanged.

### Remaining Rust-only migration

Status as of 2026-11-03 (main at `097d7401e`).

- **Done: production runs only the Rust daemon.** `isCompatibleDaemonHello` accepts a daemon
  only when it reports `prime-agent.daemon` protocol 7, schema revision 30, and the Rust
  flavor: a `runtime.buildId` starting with `pa-daemon-rs-`, or the Rust schema id
  `protocol-7-schema-30-8e4b17c2a9f5` (`web/server/src/daemon-protocol.ts:14-25,489-509`). A
  TypeScript v0.9.8 daemon is refused even though it speaks protocol 7. The startup probe refuses
  any other daemon on the socket instead of attaching to it
  (`web/server/src/daemon-runtime.ts:160-162,185-200,225-232`).
- **Done: every session uses Fleet's own connection.** Each session attaches through
  `FleetDaemonAgentConnection` (`web/server/src/fleet-daemon-connection.ts:214`), built on
  Fleet's protocol-7 socket client (`daemon-socket-client.ts`). Fleet owns attach, chunked
  snapshots, cursor dedupe, reconnect and resync, and the session commands. Create and resume
  both attach this way (`daemon-runtime.ts:415,908`). The SDK's `DaemonClient` and
  `DaemonAgentConnection` are no longer on the production path. They survive only in the
  contract-replay harness, which `fleet-adapter-contract.test.ts` checks against the Fleet
  adapter so both produce the same `ChatStreamEvent` output.
- **Done: native binary.** Fleet spawns the pinned Rust binary directly, either from
  `FLEET_PRIME_AGENT_BIN` or from `ensurePrimeRuntime`. It never runs the npm migration
  launcher or the network installer (`daemon-runtime.ts:130-141,234-235`). The pin is
  checksum-verified; see `docs/guides/upstream-runtime.md`.
- **In progress: pin bump to v0.10.2** (draft PR #320). Protocol and schema are unchanged. The
  PR adds a live v0.10.2 fixture set (`daemon-frames/rust-v0.10.2/`) with a failing tool, which
  pins the `isError` → `output-error` mapping.
- **Remaining: the legacy SDK removal** (owner: prime api, prime rust advising). On main, 12
  production files under `web/server/src` still import the v0.9.8 SDK family. Value imports
  are in only four of them:
  - `legacy/prime-agent-sdk.ts`, the R1b bridge: settings, auth storage, the resource loader,
    and the read-only session reader;
  - `in-process-test-connection.ts`, the deterministic test adapter;
  - `handlers/chat-mcp.ts` and `mcp-connections.ts`, which import `BUILTIN_MCP_CATALOG` from
    `@earendil-works/pi-ai/mcp`.

  The rest are type-only imports, which are being swapped for Fleet-owned types.
  `scripts/server-sdk-imports.baseline.json` shrinks with each PR and is deleted last.
- MCP catalog: upstream has no session-less catalog command. Built-in servers appear only in a
  session's `get_mcp_connections` response, so session-less paths should use a small Fleet-owned
  list. Upstream's list is `linear` and `notion`, the same as the SDK's.
- Settings, provider credentials and OAuth: settings reads use Fleet's bounded read-only
  projection, settings edits show terminal guidance, and provider and MCP OAuth sign-in use
  terminal guidance. Credential status and logout, and provider credential and model
  management, still go through the legacy bridge. Replace them with supported daemon
  operations or explicit terminal or read-only fallbacks that preserve existing data. Never
  substitute a transcript reader that repairs or rewrites session files.
- Cross-project forks are unavailable and leave the source session untouched. Same-project
  forks go through the daemon's `fork` command.
- Once nothing above needs the SDK, remove the TypeScript package family from production and
  development dependencies, together with its manifest fields, packaging, lockfile entries and
  import guard. Keep the Rust pin checksum-verified.

### R2 / R3: pin and packaging (done)

- The native binary is pinned with archive and executable checksums in `PRIME_AGENT_RUNTIME.json`.
- Neither the npm launcher nor the network installer is ever spawned, in CI or in production.
- The `$TMPDIR/prime-agent-<uid>` socket path is kept.

### R4: documentation

- `ARCHITECTURE.md`
- `docs/reference/adapter-contract.md`
- `docs/guides/upstream-runtime.md`
- `docs/guides/releasing.md`
- ADR 0002, `docs/adr/0002-rust-daemon-cutover.md`, records the cutover decision. The
  existing 0001 is upstream history.

## UI track (prime ui)

- **U1: dead UI only.** Remove code that no runtime reaches. Also remove the assistant-ui
  registry entry from `web/app/components.json`.
- **U2: pilot.** Move Message, Trace and Reasoning to AI Elements (presentation only, no
  `useChat` or AI SDK transport). Include before and after bundle sizes.
- U2 remains outstanding. The AI Elements registry announced its move to shadcn/ui and
  deprecation at the end of November 2026; check the supported successor and audit registry
  changes before installing. A dry run for Message proposed replacing existing Button and
  Separator files and adding dependencies; do not overwrite those components blindly.
- **U3+: one surface per PR.**
- Keep today's look. Polish only where it makes things more consistent or simpler.
- Add components through Shadcn (`base-nova`), with the Shadcn audit checklist in each PR
  body.
- `questionnaire` and Confirmation are dropped.

### Pages

- `/agents`, with heartbeat and cron as a section (no separate Schedules page for now).
- `/connectors`: list MCP servers, add one with a static token, and remove one. OAuth
  shows a terminal-login hint.
- The initial Agents page lists recent sessions and indicates scheduling is unavailable;
  it does not yet manage agents or schedules. The initial Connectors page reuses existing MCP
  configuration and OAuth; its existing bearer-token form takes an environment variable name,
  not a raw token. Daemon-backed operations and capability-driven controls remain outstanding.
- Skills stay in the session panel.
- No Harness or Factory page. Refine stays a top-bar action.

### Layout

- The model picker lives in the composer.
- Side panel tabs: Workspace, Subagents, Session, REPL.
