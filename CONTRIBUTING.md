# Contributing to Fleet Prime Agent

This document covers contributor process. `AGENTS.md` is the repository-wide engineering and agent execution contract; do not duplicate it here.

## Ways to contribute

- Report bugs or request features with the issue templates.
- Fix an existing issue or improve documentation.
- Ask questions on [GitHub Discussions](https://github.com/Qredence/fleet-prime-agent/discussions).

All participants must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Fleet supports macOS and Linux. Windows is not supported.

## Requirements

- Node.js 22.12.0 or later (see `.nvmrc`)
- pnpm 11.15.1 or later (`packageManager` in the root `package.json`; Corepack auto-pin is disabled)
- Python 3.10 or later for the managed IPython kernel
- cairo, pango, jpeg, gif, and rsvg development libraries if you run design render checks locally (CircleCI installs these)

Install pnpm explicitly, for example:

~~~bash
corepack enable && corepack prepare pnpm@11.15.1 --activate
~~~

or `npm exec pnpm@11.15.1`.

## Names

| Name | Meaning |
| --- | --- |
| `@qredence/fleet` | Published launcher on npm (`fleet-agent` / `fleet-prime`) |
| `@prime-agent/web`, `web-design`, `web-protocol`, `web-server` | Private workspace packages |
| `lib/pi`, `fleet-pi` | Fleet chat product code; `pi` is historical (pi-mono), not a current package |
| Prime Agent | External execution engine, pinned by `PRIME_AGENT_RUNTIME.json` |

## Where to change X

| Change | Package |
| --- | --- |
| UI copy, layout, tool cards | `web/design` and composition in `web/app` |
| HTTP/NDJSON/SSE wire type | `web/protocol` (`ChatStreamEvent`) |
| Daemon mapping, sessions, sanitization | `web/server` |
| Thin HTTP route wrapper | `web/app/src/routes/api/` |
| Runtime pin | follow [docs/guides/upstream-runtime.md](docs/guides/upstream-runtime.md) |
| Published launcher | `packages/fleet-web` |

## Getting started

1. Fork and clone the repository.
2. Install the workspace with `pnpm install` from the repository root. For a source install that also builds the web runtime and writes `~/.local/bin/fleet-agent`, run `./install.sh` instead. Do not run `./fleet-prime.sh install`.
3. Create a focused branch and make the change.
4. Run `pnpm run check`.
5. Run focused behavioral tests from the owning workspace when behavior changed. For example:

   ~~~bash
   pnpm --filter @prime-agent/web-server exec vitest run src/__tests__/prime-bridge.test.ts
   ~~~

6. Run `pnpm run format` only when you intentionally want Biome to write formatting changes.

Playwright smoke (`pnpm --filter @prime-agent/web test:e2e`) is local-only; CircleCI does not run it.

Never use `npm install` or `npm ci` at the repository root, and do not add a root `package-lock.json`.

Provider credentials belong in **Settings → Providers**, not in the repo. See `.env.example` for optional Vite/debug flags.

## Changesets

User-visible changes to the published `@qredence/fleet` package require a Changeset. Documentation-only, CI-only, and internal changes that do not affect the released package do not need one; state the no-release reason in the pull request.

Create a Changeset with:

~~~bash
pnpm changeset
~~~

The release automation turns accumulated Changesets into a release pull request. Prime Agent engine release notes belong upstream.

## Pull requests

- Keep one logical change per pull request and include only related files.
- Describe the behavior or process change, affected packages, and validation performed.
- Complete the pull request template.
- Maintainers review and merge; contributors do not merge their own pull requests.

## Issues and security

Use the issue template that matches the problem and include reproduction steps, expected behavior, actual behavior, and relevant environment details.

Report vulnerabilities privately according to `SECURITY.md`; do not open a public issue for a security problem.

## Documentation map

- [Documentation index](docs/README.md) — guides, reference, and ADRs.
- [ARCHITECTURE.md](ARCHITECTURE.md) — system ownership, boundaries, and data flow.
- [Adapter contract](docs/reference/adapter-contract.md) — browser/server compatibility and privacy guarantees.
- [Upstream runtime guide](docs/guides/upstream-runtime.md) — runtime pin upgrades and daemon compatibility.
- [Release guide](docs/guides/releasing.md) — release automation and artifact publication.
- [Manual tmux testing](docs/guides/tmux-testing.md) — interactive terminal testing.
- [React Doctor](docs/guides/react-doctor.md) — optional React audit.
- [Support](SUPPORT.md) — support and community channels.
