# Prime Agent v0.9.8 (TypeScript daemon) raw frame fixtures

Baseline for the Rust v0.10.1 cutover (PR 0 of the approved v0.10.1 plan, see
`docs/plans/prime-agent-v0.10.1.md`). Same layout as the sibling `rust-v0.10.1/` set.

Per scenario:

- `<scenario>.jsonl`: raw daemon → client frames, one JSON frame per line, in arrival order,
  from both the supervisor socket (JSONL) and the direct worker socket (private framing,
  payload decoded with the package's own `PrivateFrameDecoder`). Scrubbed, see below.
- `<scenario>.commands.jsonl`: what the client wrote. Supervisor commands are full
  `{"type":"command",...}` envelopes. Worker-socket commands are the bare command payloads
  the direct transport sends.
- `<scenario>.events.json`: Fleet `ChatStreamEvent[]` produced by replaying the frames through
  the stock `DaemonAgentConnection` and `web/server/src/event-mapper.ts`
  (`src/__tests__/daemon-frame-replay.ts`). It is generated, so never edit it by hand.

`src/__tests__/daemon-frame-contract.test.ts` replays every scenario. The output must equal
`events.json`, and every event must parse against the frozen `ChatStreamEventSchema`. Any
mapper or contract change fails CI (CircleCI `test-web` already runs the web-server suite).

The harness covers the adapter and the mapper. It does not cover `PrimeBridge`'s pre-mapper
interception of daemon `extension_ui_request` dialogs (`select` / `confirm` / `input` /
`editor` / questions), `notify` or `setStatus`. Those go to the dialog registry or become
`state` frames in production before the mapper sees them.

## Provenance

- Runtime: the pinned `prime-agent@0.9.8` tarball from `PRIME_AGENT_RUNTIME.json`
  (sha256 `d7b72785…1274`). Hello: protocol `prime-agent.daemon`/7, `schemaRevision` 30,
  `schemaId` `protocol-7-schema-30-f908f493c9e1`, `appVersion` 0.9.8, `runtime.buildId` `beta-1-g7d442aafa`.
- Spawned like `web/server/src/daemon-runtime.ts`:
  `node <prime-agent>/dist/bundle/cli.js --mode daemon --daemon-socket <scratch>/d.sock`.
  It uses a throwaway HOME, TMPDIR and agent dir, `PRIME_AGENT_TELEMETRY=0`, `PI_OFFLINE=1`
  and `create.config.telemetryDisabled: true`, and attaches with Fleet's options
  (`sendClientEnv: false`, `supportsExtensionUi: true`, direct worker transport).
- Model: a scripted provider (`scripts/contract-fixtures/scripted-provider-extension.ts`)
  that the worker loads as an ordinary extension. It is built on pi-ai's faux provider and
  uses no network or credentials. The extension also registers `fleet_echo`,
  `fleet_progress`, `fleet_wait` and `fleet_confirm`. `ipython` is the real built-in kernel
  tool (local `ipykernel`).

| Scenario | Source | What it pins |
|---|---|---|
| `normal-turn` | recorded | Thinking + text stream, `agent_end` with a hidden `role:"custom"` `display:false` `harness_digest` message |
| `tool-call` | recorded | Extension tool `fleet_echo` start/end, then a final answer |
| `ipython-call` | recorded | Built-in `ipython` tool (`print(6 * 7)`), its `tool_execution_update`s and ipython `setWorkingMessage` UI requests |
| `cancel-mid-tool` | recorded | `abort` during an `ipython` `time.sleep`: tool ends `isError`, run settles |
| `compaction` | recorded | Two turns, then manual `compact`: `compaction_start` / `compaction_end` |
| `auto-retry` | recorded | Retryable 429 → `auto_retry_start`, second `agent_start`, `auto_retry_end{success}` |
| `queued-steer` | recorded | `steer` while `fleet_wait` runs: `session_action_update`s, steer delivered as the next run |
| `extension-ui` | recorded | `fleet_confirm` → `ctx.ui.confirm` → `extension_ui_request{method:"confirm"}` → `extension_ui_response`. **v0.9.8 baseline, no Rust source** (removed in v0.10.1) |
| `subagent-spawn` | recorded | `rlm.spawn()` inside `ipython`: parent `rlm_child_update` queued → running → done |
| `tool-update` | recorded | `fleet_progress` `onUpdate` ×2: `tool_execution_update` / `_end` carry the same `toolCallId` (and, on v0.9.8, `toolName`) as `_start` |

Nothing in this set is synthesized.

Not in this set (R1 ships them in `rust-v0.10.1/`): `python_repl`, `session_binding`,
`model_catalog_changed`, and nameless `tool_execution_update` / `_end`.

## Regenerate

From `web/server`, on a machine with `python3` + `ipykernel`:

```sh
CONTRACT_FIXTURE_SCRATCH=/short/scratch/dir pnpm run record:contract-fixtures [scenario ...]
```

The scratch path must be short, because Unix socket paths are limited to about 104 bytes on
macOS. It defaults to `web/server/.contract-fixtures-scratch` (gitignored). Live recording
is timing-dependent: the number of `tool_execution_update` / `setWorkingMessage` frames and
the event interleaving can change between runs, so review the regenerated diff.

## Scrubbing

Applied by the recorder before writing:

- Paths: scratch run root → `/fixture`, `$TMPDIR` → `/tmp`, scratch HOME and the real home →
  `/home/user`, repository root → `/repo`, `prime-agent-<uid>`, username → `user`,
  hostname → `host`.
- Secrets: any `*token*` / `*secret*` / `apiKey` / `grantId`-like field → `<redacted>`.
  This covers the direct-transport `peer_auth` ticket.
- IDs: UUIDs → `00000000-0000-4000-8000-00000000000N`, 12-hex ids (sessions, generations,
  workers) → `f0000000000N`, 8-hex ids → `e000000N`. All are numbered by first appearance,
  so equal ids stay equal.
- Time: ISO timestamps and epoch-ms numbers are renumbered to 2026-01-01 + N s, keeping
  their order. `*Pid`, socket `dev` / `ino` → `0`, `supervisorProcessStartId` →
  `ps:<start>`, retry `delayMs` jitter → `50`. `schemaId` is kept verbatim.

`daemon-frame-contract.test.ts` fails if any fixture under `daemon-frames/` contains
`/Users/`, `/Volumes/`, `/private/var/`, a non-placeholder `/home/<name>`, `sk-…`, `gh?_…`,
a bearer credential, or an unredacted token field.
