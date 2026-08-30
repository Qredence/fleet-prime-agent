# Upstream Runtime Guide

Read this before upgrading the pinned Prime Agent runtime or touching
daemon-facing code in `web/server`.

## Runtime upgrades

Prime Agent is consumed as a stock, checksum-pinned release tarball rather than
vendored source. To upgrade it, update `PRIME_AGENT_RUNTIME.json` and the
matching dependency URLs, run `npm install` plus `pnpm --dir web install`, then
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
