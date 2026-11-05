# Upstream Prime Agent Runtime

Use this runbook when changing `PRIME_AGENT_RUNTIME.json`, runtime package references, daemon-facing `web/server` code, or the Prime Agent protocol boundary.

## Source of truth

`PRIME_AGENT_RUNTIME.json` pins the Rust runtime Fleet runs, under `rust`: `version`, `baseUrl`, and for each supported target (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`) the release `archive` name, its `sha256`, and the `executableSha256` of the extracted `prime-agent` binary.

Its top-level `package`, `version`, `tarball`, and `sha256` pin the legacy TypeScript SDK (v0.9.8). Only Fleet's remaining compatibility code uses it, and the SDK is being removed; see `docs/plans/prime-agent-v0.10.1.md`. A pin does not establish the connected daemon's version: an executable override or an existing daemon can differ.

How the pin is enforced:

- `packages/fleet-web/bin/prime-runtime.mjs` (`ensurePrimeRuntime`) is the single installer. It downloads `<baseUrl>/<archive>` and refuses it unless the archive digest matches. It then extracts it and refuses it again unless the `prime-agent` digest matches. It installs the binary together with its packaged `prime-agent-runtime/` under `~/.prime/fleet/runtimes/<version>/<target>`. The npm launcher (`fleet-prime.mjs`) and `web/server/src/prime-runtime.ts` both call it.
- `scripts/check-prime-agent-runtime.mjs` (`pnpm run check:runtime`, part of `pnpm run check`) validates that every target pins both digests. It also cross-checks the legacy SDK tarball against the package manifests and the lockfile.
- `web/server/src/daemon-runtime.ts` spawns the native binary directly (`prime-agent --mode daemon --daemon-socket <socket>`), from `FLEET_PRIME_AGENT_BIN` or from `ensurePrimeRuntime`. It never runs the npm migration launcher or the network installer.
- `web/server/src/daemon-protocol.ts` (`isCompatibleDaemonHello`) accepts only a `prime-agent.daemon` protocol 7, schema revision 30 daemon of the Rust flavor. That means a `runtime.buildId` starting with `pa-daemon-rs-`, or schema id `protocol-7-schema-30-8e4b17c2a9f5`.

Do not copy upstream source into Fleet. Engine, provider, model, daemon, and upstream protocol changes belong upstream; Fleet should update its pin and adapter only after the upstream capability exists.

## Bumping the Rust pin

1. Read the upstream release notes and the compare view between the current and new tags. Note anything that touches the daemon socket (`crates/pa-types/src/daemon/`, `crates/pa-daemon/src/worker/`). If the protocol version, schema revision, or schema id changes, the daemon checks in `daemon-protocol.ts` and the Fleet adapter must change in the same PR.
2. Download each target's archive plus the release `SHA256SUMS`. Compare the Fleet R2 mirror (`baseUrl`) copy of `SHA256SUMS` with the GitHub release copy; they must be identical. Verify every archive with `shasum -a 256 -c`.
3. Extract each archive. Record `sha256` of the archive and `executableSha256` of the extracted top-level `prime-agent`, which is what `ensurePrimeRuntime` checks. Confirm `prime-agent-runtime/` is in the archive and that `prime-agent --version` reports the new version.
4. Update `rust.version`, `rust.baseUrl`, and every target's `archive`, `sha256`, and `executableSha256` together. Leave the top-level SDK fields alone unless you are changing the SDK pin.
5. Optionally, run `ensurePrimeRuntime` against the local archives (a `fetch` stub reading the files, `installRoot` in a scratch directory) to prove every target installs and verifies.
6. Capture a fixture set from the new binary under `web/server/src/__tests__/fixtures/daemon-frames/rust-v<version>/`, in the layout of `rust-v0.10.1/` (`<scenario>.jsonl`, `.commands.jsonl`, optional `.script.json`):
   - Start `prime-agent --mode daemon` with a throwaway `HOME`, `TMPDIR`, and agent directory, plus `PI_OFFLINE=1`, telemetry off, and no credentials.
   - Drive it over the socket. The scripted engine (`create.config.script`) gives deterministic tool calls, including failures.
   - Scrub the frames as that set's README describes. The fixture scrub test rejects host paths and secrets.
   - Write a README with provenance: tag commit, archive and executable digests, hello fields.
7. Generate the expected outputs with `pnpm --filter @prime-agent/web-server replay:contract-events rust-v<version>`. Then add the set to `PINNED_SETS` in `daemon-frame-contract.test.ts`, and add focused assertions for any behavior the bump is for.
8. Regenerate the expected outputs for the existing sets (`v0.9.8`, `rust-v0.10.1`). They must not change. If they do, the change to the frozen `ChatStreamEvent` contract has to be deliberate and reviewed.
9. Run `pnpm run check`, then the server tests (`pnpm --filter @prime-agent/web-server test`), which include the contract replays and `fleet-adapter-contract.test.ts`, and the protocol tests.
10. Run one real turn against the new binary with `FLEET_PRIME_AGENT_BIN` pointing at it. Confirm that the hello reports the new `appVersion` and `pa-daemon-rs-<version>`, and that a tool call completes. Use an isolated `TMPDIR` so the socket does not collide with a running daemon.
11. Add a `@qredence/fleet` patch changeset that describes the runtime update for users.

## Legacy TypeScript SDK pin

Until the SDK removal lands, the top-level SDK archive pin must stay synchronized with:

- `packages/fleet-web/package.json`;
- `web/server/package.json`;
- `pnpm-workspace.yaml` runtime build allowances;
- `pnpm-lock.yaml`.

The same release version also pins `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`. `pnpm run check:runtime` derives the expected `prime-agent-core` and `prime-agent-ai` tarball URLs from the manifest version and fails on drift. `PRIME_RUNTIME_VERIFY_TARBALL=1 node scripts/check-prime-agent-runtime.mjs` also downloads the SDK tarball and checks its SHA-256 and lockfile integrity.

Import and dependency keys use the Earendil package names, but the resolved artifacts are the matching Prime Agent release-family tarballs, not live npm registry versions. Do not replace those URL pins with a normal `name@version` from the public registry. The separately published `@earendil-works/pi-*` packages are a different version line.

## Compatibility checks

A daemon or protocol change requires both the upstream compatibility change and the matching Fleet adapter and test update. Fleet's protocol-7 types in `daemon-protocol.ts` cite the upstream source they mirror; update those citations when the shapes are re-verified against a new tag.

### Manual analysis scenario

To check an agent's interpretation, ask it: "Identify Fleet's configured Rust runtime and legacy TypeScript SDK versions, cite the source for each, and say whether the active daemon version was observed." A correct answer reads `rust.version` and the top-level `version` in `PRIME_AGENT_RUNTIME.json`, labels them separately, and does not infer the active daemon version from either pin. Run this scenario manually with a model only when a live provider call is authorized; the runtime check and its local tests verify labels, not model reasoning.

Do not solve an upstream incompatibility by copying or patching the runtime locally. If the daemon contract needs a new capability, keep the change at the `web/server`/`web/protocol` boundary and document the current browser guarantee in `docs/reference/adapter-contract.md`.

## Advisory review

Review the pinned archives and, while it remains, the SDK's transitive dependencies on every upgrade. The current lockfile contains `extract-zip@2.0.1`, so re-check GHSA-jmr9-qjv8-65gv and its patched-release status before changing or republishing the runtime package set. Do not bypass the workspace minimum-release-age policy for ordinary updates; record an explicit reviewed reason for an urgent security override.
