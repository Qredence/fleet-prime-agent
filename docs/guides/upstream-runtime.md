# Upstream Runtime Guide

Read this before upgrading the pinned Prime Agent runtime or touching
daemon-facing code in `web/server`.

## Runtime upgrades

Prime Agent is consumed as a stock, checksum-pinned release tarball rather than
vendored source. To upgrade it, update `PRIME_AGENT_RUNTIME.json` and the
matching dependency URLs, run `pnpm install`, then
run `node scripts/check-prime-agent-runtime.mjs`, web-server type checks, and
the adapter parity tests. Review changes to the public runtime APIs consumed by
`web/server` and the daemon protocol before merging. Do not patch upstream code
inside this repository.

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
  tree (`packages/fleet-prime > prime-agent > extract-zip` and
  `web/server > prime-agent > extract-zip`). As of 2026-08-31 no patched
  release exists. The latest extract-zip release remains 2.0.1, from 2020.
  This cannot be fixed from
  Fleet — there is no version to override to and the dependency belongs to
  the upstream runtime. Recheck when bumping `PRIME_AGENT_RUNTIME.json`; if
  the new release still resolves extract-zip 2.0.1, report the advisory
  upstream before adopting it.
