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
`packages/fleet-prime` is Fleet's thin launcher package; it is not an upstream
source checkout. Do not add copies of upstream source under `packages/` or
`prime-agent-runtime/`.

The web server consumes the same pinned `prime-agent` package as the Fleet
launcher. Keep its tarball URL and version aligned with
`PRIME_AGENT_RUNTIME.json`.

## Install and dev commands

- Repo root: `npm install` only. Inside `web/`: `pnpm install` only.
- Never `npm install` inside `web/`, and never `pnpm install` at the repo root.
- pnpm 11 settings live in `web/pnpm-workspace.yaml` (not `.npmrc`).
- Dev: `pnpm --dir web --filter @prime-agent/web dev` (or `npm run dev:web`).

## Recovering from a root pnpm install

Running pnpm at the repo root (instead of `--dir web`) rewrites the root
`node_modules` to a pnpm layout and drops a stray `pnpm-workspace.yaml` (with
placeholder `allowBuilds` values) and `pnpm-lock.yaml` at the root. If this
happens, delete those two files and re-run `npm install` at the root. Never
commit them.
