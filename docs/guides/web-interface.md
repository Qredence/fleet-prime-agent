# Web Interface Guide

Read this before touching anything under `web/`.

This repo's web UI is the standalone Qredence product. It is not merged into
upstream `PrimeIntellect-ai/prime-agent`. The stock upstream `prime-agent`
package is the execution runtime; the web stack is the interface.

## Stack layout

- Interface: `web/app` (TanStack Start) + `web/design`
- Adapter: `web/server` (`prime-bridge.ts`, `event-mapper.ts`, HTTP handlers)
- Contract: `web/protocol/src/chat-protocol.ts`

Boundary rules:

- Browser code talks HTTP (NDJSON + SSE) only. Do not import `prime-agent`
  from `web/app/src` or `web/design`.
- `web/server` is the only adapter layer that imports `prime-agent`; it owns
  the daemon connection, event mapping, and runtime compatibility.

## Runtime pin

`PRIME_AGENT_RUNTIME.json` pins the stock upstream tarball and SHA-256.
`packages/fleet-web` is Fleet's thin launcher package; it is not an upstream
source checkout. Do not add copies of upstream source under `packages/` or
`prime-agent-runtime/`.

The web server consumes the same pinned `prime-agent` package as the Fleet
launcher. Keep its tarball URL and version aligned with
`PRIME_AGENT_RUNTIME.json`.

## Install and dev commands

- Repo root: `pnpm install` only. It resolves the whole workspace (web product,
  launcher package) through the root `pnpm-lock.yaml`.
- Never run `npm install` at the repo root; it drops a `package-lock.json` and
  rewrites `node_modules` to an npm layout.
- pnpm 11 settings live in the root `pnpm-workspace.yaml`.
- Dev: `pnpm --filter @prime-agent/web dev` (or `pnpm run dev:web`).

## Recovering from a root npm install

Running npm at the repo root drops a `package-lock.json` and rewrites the root
`node_modules` to an npm layout. If this happens, delete `package-lock.json`
and `node_modules`, then re-run `pnpm install`. Never commit a
`package-lock.json`.

## Recovering from a stale Prime Agent daemon

The web server attaches to the per-user daemon socket
(`$TMPDIR/prime-agent-<UID>/daemon.sock`, where `<UID>` is the current user's
UID, for example `prime-agent-501` for UID 501) whenever the daemon there
answers the protocol probe. A daemon started from a checkout's `node_modules` embeds that
install path. Reinstalling the workspace or changing its layout (for example
the pnpm workspace unification) while such a daemon is still running leaves it
accepting connections but unable to spawn session workers, so every chat send
fails after 30s with:

    Timed out after 30000ms waiting for the Prime Agent daemon response to "create".

Check for attached clients first (`lsof` on the socket), then stop the
orphaned daemon. Sessions persist in `~/.prime/agent/sessions`; the next
request spawns a fresh daemon from the pinned runtime resolved through the
workspace.
