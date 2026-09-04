# Upstream Prime Agent Runtime

Use this runbook when changing `PRIME_AGENT_RUNTIME.json`, runtime package references, daemon-facing `web/server` code, or the Prime Agent protocol boundary.

## Source of truth

`PRIME_AGENT_RUNTIME.json` owns the `prime-agent` release archive URL and checksum. Keep these references synchronized with it:

- `packages/fleet-web/package.json`;
- `web/server/package.json`;
- `pnpm-workspace.yaml` runtime build allowances;
- `pnpm-lock.yaml`;
- any other direct runtime-family URL or version reference found by repository search.

Do not copy upstream source into Fleet. Engine, provider, model, daemon, and upstream protocol changes belong upstream; Fleet should update its pin and adapter only after the upstream capability exists.

## Upgrade procedure

1. Update the manifest package, version, tarball URL, and SHA-256 together.
2. Update every direct package and workspace reference to the same release archive or runtime-family release.
3. Run `pnpm install` from the repository root to refresh the workspace lockfile.
4. Run:

   ~~~bash
   pnpm run check:runtime
   PRIME_RUNTIME_VERIFY_TARBALL=1 node scripts/check-prime-agent-runtime.mjs
   ~~~

   The second command downloads the archive and is the checksum/integrity check; use it when network access is appropriate.
5. Run the focused daemon/adapter suites from the server workspace, especially `daemon-runtime.test.ts`, `event-mapper.test.ts`, `prime-bridge.test.ts`, `sse-replay.test.ts`, and `chat-events.test.ts` when their behavior is affected.
6. Run `pnpm run check`. If protocol or browser behavior changed, run the relevant focused browser tests and escalate to `pnpm run test:web`.

## Compatibility checks

`web/server/src/daemon-runtime.ts` probes the local daemon and accepts only the daemon name and protocol version supported by the pinned runtime. A daemon/protocol change therefore requires both the upstream compatibility change and the corresponding Fleet adapter/test update.

Do not solve an upstream incompatibility by copying or patching the runtime locally. If the daemon contract needs a new capability, keep the change at the `web/server`/`web/protocol` boundary and document the current browser guarantee in `docs/reference/adapter-contract.md`.

## Advisory review

Review the pinned archive and its transitive dependencies on every upgrade. The current lockfile contains `extract-zip@2.0.1`, so re-check GHSA-jmr9-qjv8-65gv and its patched-release status before changing or republishing the runtime package set. Do not bypass the workspace minimum-release-age policy for ordinary updates; record an explicit reviewed reason for an urgent security override.
