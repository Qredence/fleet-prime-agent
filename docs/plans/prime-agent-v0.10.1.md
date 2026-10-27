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

### Remaining Rust-only migration

- Supervisor session listing and daemon-backed forks already use the Rust daemon. Per-session
  connections still use the TypeScript SDK's `DaemonClient` and `DaemonAgentConnection`;
  replacing them requires equivalent attach, snapshot, event, reconnect, and request-recovery
  behavior before the SDK connection can be removed.
- The daemon provides model catalog and resource snapshot reads and limited MCP token
  management. Existing project-level endpoints can run before a session exists, and resource
  snapshots do not cover every field those endpoints return. Preserve their current behavior
  while adapting these paths.
- Provider credential and OAuth writes, custom model registration, general settings updates,
  cross-project forks, and some transcript reads still depend on SDK-backed paths. Keep the
  minimum bridge until supported upstream capabilities preserve these workflows and existing
  data. Do not substitute a transcript reader that repairs or rewrites session files.
- Once those paths and deterministic test adapters no longer need the SDK, remove the
  TypeScript package family from production and development dependencies together with its
  manifest, packaging, lockfile, and import-guard coupling. Keep the Rust pin checksum-verified.

### R2 / R3: pin and packaging

- Pin the native binary with a checksum.
- Never spawn the npm launcher or the network installer in CI.
- Keep the `$TMPDIR/prime-agent-<uid>` socket path.

### R4: documentation

- `ARCHITECTURE.md`
- `docs/reference/adapter-contract.md`
- `docs/guides/upstream-runtime.md`
- `docs/guides/releasing.md`
- ADR 0001 (note: `docs/adr/0001-…` already exists, so the new decision record may take the
  next free number)

## UI track (prime ui)

- **U1: dead UI only.** Remove code that no runtime reaches. Also remove the assistant-ui
  registry entry from `web/app/components.json`.
- **U2: pilot.** Move Message, Trace and Reasoning to AI Elements (presentation only, no
  `useChat` or AI SDK transport). Include before and after bundle sizes.
- **U3+: one surface per PR.**
- Keep today's look. Polish only where it makes things more consistent or simpler.
- Add components through Shadcn (`base-nova`), with the Shadcn audit checklist in each PR
  body.
- `questionnaire` and Confirmation are dropped.

### Pages

- `/agents`, with heartbeat and cron as a section (no separate Schedules page for now).
- `/connectors`: list MCP servers, add one with a static token, and remove one. OAuth
  shows a terminal-login hint.
- Skills stay in the session panel.
- No Harness or Factory page. Refine stays a top-bar action.

### Layout

- The model picker lives in the composer.
- Side panel tabs: Workspace, Subagents, Session, REPL.
