# Prime Agent v0.10.2 (Rust daemon) raw frame fixtures

Raw `daemon → client` JSONL frames captured from the native Prime Agent v0.10.2 daemon, in the
same layout and with the same scrubbing as the sibling [`rust-v0.10.1/`](../rust-v0.10.1/README.md) set.
That set stays the main Rust contract; this one adds what v0.10.2 is pinned for.

## Provenance

- Binary: GitHub release `v0.10.2` (tag commit `ea9d9602e`), asset `prime-agent-0.10.2-darwin-arm64.tar.gz`
  - tarball sha256 `2f0894811f8ba047eb1874cc1d7392f45c0d6135be6090e7601983de17a6d1d7` (matches upstream `SHA256SUMS`)
  - `prime-agent` executable sha256 `85fc476f45bc3b316152bb266b685b14a744464c057211c3334eab2da78c727a` (matches `PRIME_AGENT_RUNTIME.json`)
- Started directly as `prime-agent --mode daemon` on the default socket, with a throwaway `HOME`/`TMPDIR`/agent dir on the SSD, `PI_OFFLINE=1`, telemetry off, no credentials.
- Hello: protocol `prime-agent.daemon`/7, `schemaRevision` 30, `schemaId` `protocol-7-schema-30-8e4b17c2a9f5` (unchanged from v0.10.1), `runtime.buildId` `pa-daemon-rs-0.10.2`.
- Captured 2026-11-03.

## Files

| File | Source | What it pins |
|---|---|---|
| `tool-execution-error.jsonl` (+ `.commands.jsonl`, `.script.json`) | live, scripted engine | create → attach → `prompt_and_wait` → `kill`. One `bash` call whose result is an error: `tool_execution_end` carries `isError:true` (top level and inside `result`), the `toolResult` message carries `isError:true`, and Fleet maps it to an `output-error` tool part with the error text |

The daemon socket already sent `isError` on `tool_execution_end` in v0.10.1
(`crates/pa-daemon/src/worker/turn.rs:809-818`); the v0.10.2 fix (#3766,
`crates/pa-core/src/session_engine/session_events.rs:190-202`) restores it on the `--mode rpc`
stream and `--mode json` print output, which Fleet does not use. No v0.10.1 fixture recorded a
failing tool, so this set pins the error path against a live daemon.
