# Upstream Runtime Guide

Read this before upgrading the pinned Prime Agent runtime or touching
daemon-facing code in `web/server`.

## Runtime upgrades

Prime Agent is consumed as a stock, checksum-pinned release tarball rather than
vendored source. To upgrade it:
1. Update `PRIME_AGENT_RUNTIME.json` with the new manifest version, tarball URL,
   and SHA-256 hash, ensuring `manifest.version` matches the tarball filename.
2. Update `pnpm-workspace.yaml` `allowBuilds` for the new tarball URL.
3. Update matching dependency URLs in `packages/fleet-web/package.json` and `web/server/package.json`.
4. Run `pnpm install`.
5. Run `PRIME_RUNTIME_VERIFY_TARBALL=1 node scripts/check-prime-agent-runtime.mjs`.
6. Run web-server type checks (`pnpm run check`) and the adapter parity tests.
Review changes to the public runtime APIs consumed by `web/server` and the daemon protocol before merging. Do not patch upstream code inside this repository. See the `.agents/skills/prime-runtime-upgrade/SKILL.md` skill for the complete runbook.

## Daemon protocol changes

The daemon protocol is upstream-owned. When a pinned runtime upgrade changes
the protocol or schema revision, review
`web/docs/architecture/fleet-adapter-contract-v1.md`, update `web/server`, and
run the daemon-runtime and bridge parity tests in the same PR.

## Adding a new LLM provider

Engine features (providers, models, daemon protocol, CLI behavior) are
developed in `PrimeIntellect-ai/prime-agent`, not here. Contribute there, then
update the pinned stock runtime release and Fleet adapter compatibility
checks.

## Known upstream advisories

- **GHSA-jmr9-qjv8-65gv (high)** — `extract-zip <= 2.0.1` unvalidated
  symlink path traversal, reachable through the pinned runtime's dependency
  tree (`packages/fleet-web > prime-agent > extract-zip` and
  `web/server > prime-agent > extract-zip`). As of 2026-08-31 no patched
  release exists. The latest extract-zip release remains 2.0.1, from 2020.
  This cannot be fixed from
  Fleet — there is no version to override to and the dependency belongs to
  the upstream runtime. Recheck when bumping `PRIME_AGENT_RUNTIME.json`; if
  the new release still resolves extract-zip 2.0.1, report the advisory
  upstream before adopting it.
