# Prime Agent v0.10.1 (Rust daemon) raw frame fixtures

Raw `daemon → client` JSONL frames captured from the native Prime Agent v0.10.1 daemon,
one frame per line, exactly as read off the unix socket (then scrubbed, see below).
`*.commands.jsonl` are the client command envelopes that produced them.

## Provenance

- Binary: GitHub release `v0.10.1` (tag commit `8aac8692456c00c01d4e53e60e6d3347a3506559`),
  asset `prime-agent-0.10.1-darwin-arm64.tar.gz`
  - tarball sha256 `2b47bd9cefa0b531151aaeb7295073ba0a16cf694177c18b4f9f74a54b24e279` (matches `SHA256SUMS`)
  - `prime-agent` executable sha256 `d96a650b2eb526141ac6e2e68d3d1fad694b8ba3988f0b312572e461bc167e32` (matches `manifest.json` `executableSha256`)
- Started directly as `prime-agent --mode daemon` on the default socket (`$TMPDIR/prime-agent-<uid>/daemon.sock`), never via the npm launcher.
- Hello: protocol `prime-agent.daemon`/7, `schemaRevision` 30, `schemaId` `protocol-7-schema-30-8e4b17c2a9f5`, `runtime.buildId` `pa-daemon-rs-0.10.1`.
- Captured 2026-10-23 with a real model (`openai-codex` / `gpt-6-luna`, thinking `low`).

## Files

| File | Source | What it pins |
|---|---|---|
| `daemon-hello.jsonl` | live | Rust hello: schemaId, buildId, `updateResume`, server capabilities (no `extension_ui`) |
| `real-turn-python-repl.jsonl` (+ `.commands.jsonl`) | live | create → attach (chunked snapshot) → `get_model_catalog` → `get_state` → `prompt_and_wait`. Two `python_repl` tool calls, coalesced `text_delta`/`toolcall_delta`, `agent_end` with a hidden `role:"custom"` `harness_digest` message |
| `tool-execution-nameless.jsonl` | live | `tool_execution_start` (has `toolName`/`args`), `tool_execution_update` (`toolCallId`+`partialResult` only), `tool_execution_end` (`toolCallId`+`result`+`isError`, **no `toolName`**) |
| `session-binding.jsonl` (+ `.commands.jsonl`) | live | kill → `session_closed{reason:"killed"}` → re-create on the same `sessionPath` → **top-level** `session_binding` (not inside `session_event`, no `meta`), sent twice (supersede on create, rebind on stale-id attach) |
| `model-catalog-changed.jsonl` | **source-derived** (`crates/pa-daemon/src/worker/connection.rs:58-62`, broadcast at `supervisor/supervision.rs:896-901`) | top-level `{"type":"model_catalog_changed"}`; only fires when a background catalog refresh differs, not reproducible without editing the agent dir |
| `telemetry-disabled-attach.json` | live | `config.telemetryDisabled` is ignored (a telemetry-disabled attach is refused); top-level `create.telemetryDisabled:true` is honored |

## Scrubbing

Applied by the capture script before writing: scratch paths → `/fixture`, `$TMPDIR` → `/tmp`,
home → `/home/user`, executable paths → `/opt/prime-agent/<name>`, `*Token`/secret-like string
fields → `<redacted>`, model catalog arrays reduced to the one model used, the
`get_model_catalog` payload elided, and the user's `harness_digest` content redacted.
