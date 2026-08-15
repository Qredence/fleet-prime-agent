# Prime Agent

A self-improving RLM (Recursive Language Model) coding and research agent. Use it from a web chat, a terminal UI, or a headless daemon. All three interfaces drive the same core session runtime (`@earendil-works/pi-coding-agent`) through one typed connection seam.

[![CI](https://github.com/Qredence/fleet-prime-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Qredence/fleet-prime-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What is Prime Agent

Prime Agent is a self-improving RLM coding and research agent. Its primary surface is a React 19 web chat (`web/app`) that streams agent turns, renders every model action (IPython cells, shell commands, file edits, plans, subagents, interactive questions) as dedicated cards, and keeps sessions alive even when you close the tab.

## Quick start

Make an empty directory and run the repository-owned installer:

```bash
mkdir -p fleet-prime-agent && cd fleet-prime-agent
curl -fsSL https://raw.githubusercontent.com/Qredence/fleet-prime-agent/main/install.sh | sh
```

The installer clones the repository, installs the npm and pnpm workspaces, builds the production web runtime, and links the `prime-agent` command globally. No PrimeIntellect account or repository access is required.

Run the built web frontend and backend from any project directory:

```bash
cd /path/to/project
prime-agent web
```

`prime-agent web` uses the current directory as its workspace and binds to `127.0.0.1:3000`. Override with `prime-agent web --host <host> --port <port> --cwd <directory>`.

## Interfaces

- **Web chat** — the primary surface. Streams agent turns over NDJSON, pushes out-of-turn events over SSE, and renders tool calls, plans, and questions as UI cards. For development, run `pnpm --dir web --filter @prime-agent/web dev` and open http://127.0.0.1:3000.
- **Terminal UI** — a full interactive terminal agent. Run `./prime-agent.sh` from anywhere; it preserves your working directory.
- **Daemon** — agents keep running when your terminal disconnects. Reattach later, schedule work, and let agents message each other without routing through the user.

Common terminal commands:

```bash
prime-agent agents              # Browse running, idle, and saved sessions
prime-agent attach <agent>      # Reattach to a running session
prime-agent --resume <path|id>  # Resume a saved session
prime-agent status              # Inspect background service state
prime-agent doctor [--fix]      # Inspect or repair background services
prime-agent update [--force]    # Update Prime Agent
prime-agent shutdown [--force]  # Stop every agent, worker, and background service
```

## What it can do

- **Persistent IPython is the built-in model tool** — file operations, shell commands, tool use, subagents, and context management happen through code.
- **Recursive subagents** — `rlm(...)` spawns real child agents for parallel or background work and returns their results programmatically.
- **Self-improving harness** — `/refine` reviews the current trajectory and applies small, evidence-backed updates to supplemental harness state. It never rewrites the immutable base system prompt, and recorded snapshots support rollback.
- **Skills are executable** — skills are importable Python packages; a built-in skill creator turns recurring workflows into project or personal skills.
- **Daemon-backed sessions** — agents keep running when the terminal disconnects and can be reattached later; heartbeats, schedules, and autonomous mode preserve progress across turns.
- **Agent-to-agent communication** — running agents can exchange messages and orchestrate one another.

## Requirements

- Node.js >= 22.8.0
- npm >= 11.10 (enforces the 7-day minimum release age for Prime Agent dependency updates; older npm silently ignores it)
- pnpm >= 11 (Qredence UI under `web/`)
- Git (required by the installer)
- Python >= 3.10 (only needed for the IPython runtime, `prime-agent-runtime`)

## Repository layout

An npm workspace for Prime Agent (`packages/*`) and a pnpm workspace for the Qredence UI (`web/`):

| Path | Package | Purpose |
| --- | --- | --- |
| `packages/ai` | `@earendil-works/pi-ai` | LLM provider abstraction and model registry |
| `packages/agent` | `@earendil-works/pi-agent-core` | Core agent session runtime |
| `packages/coding-agent` | `@earendil-works/pi-coding-agent` | Coding agent CLI, SDK entry point, and daemon |
| `packages/tui` | `@earendil-works/pi-tui` | Terminal UI |
| `web/protocol` | `@prime-agent/web-protocol` | Web wire contract (`ChatStreamEvent`, zod schemas, provider catalog) |
| `web/design` | `@prime-agent/web-design` | Shared web chat components and tool renderers |
| `web/server` | `@prime-agent/web-server` | HTTP adapter (`PrimeBridge`, event mapper, handlers) |
| `web/app` | `@prime-agent/web` | Web chat frontend (TanStack Start host) |
| `prime-agent-runtime` | — | Python IPython kernel shim (requires Python >= 3.10) |

`web/server` is the only web package that imports `@earendil-works/*`. Install Prime Agent with npm at the repo root, then the UI with `pnpm install` in `web/`.

## Getting started from source

```bash
npm ci                  # Prime Agent packages (npm workspace)
pnpm install --dir web  # Qredence UI (pnpm workspace)
```

Run the web chat in development:

```bash
pnpm --dir web --filter @prime-agent/web dev
```

Open http://127.0.0.1:3000. For full IPython kernel functionality, install the Python runtime shim:

```bash
pip install -e prime-agent-runtime
```

On first launch, open Settings → Providers (or run `/login`) to add an API key, then pick a model in the composer.

Before contributing a change, run `npm run check` (format, lint, type-check, installer and rendering checks; it does not run tests). Run focused tests from a package root:

```bash
cd packages/coding-agent
npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts
```

## Documentation

- **GitHub wiki** — the browsable documentation set: https://github.com/Qredence/fleet-prime-agent/wiki
- `packages/coding-agent/docs/index.md` — documentation index
- `packages/coding-agent/docs/quickstart.md` — install, authenticate, run a first session
- `packages/coding-agent/docs/rlm.md` — RLM programming model, IPython, subagents, skills, trust model
- `packages/coding-agent/docs/development.md` — build and run from source
- `web/app/ARCHITECTURE.md` — web chat architecture, the full HTTP API reference, and known limitations
- `AGENTS.md` — contribution rules and required validation

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the process and `AGENTS.md` for the repository rules every pull request must follow. Fork the repository, work on a feature branch, and open a pull request into `main`; maintainers review and merge. Add `pkg:*` labels (`pkg:agent`, `pkg:ai`, `pkg:coding-agent`, `pkg:tui`) to issues so it is clear which package they affect. All participants must follow the [Code of Conduct](CODE_OF_CONDUCT.md). Questions go to GitHub Discussions; see [SUPPORT.md](SUPPORT.md).

## Security note

Prime Agent executes model-generated Python and project commands with your user permissions. Worker and kernel processes improve lifecycle isolation and recovery; they are **not** a security sandbox. Review changes and use trusted repositories, instructions, skills, and extensions only.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

Prime Agent is a hard fork of [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent), and its lineage goes back to [pi-mono](https://github.com/badlogic/pi-mono), created by Mario Zechner (badlogic). Thank you to the Prime Intellect team for the upstream work this project builds on, and to everyone who has contributed along that lineage, especially Sebastian Müller, Kevin Thomas, Seth Karten, Armin Ronacher, Helmut Januschka, and Aliou Diallo, whose commits shaped the codebase.
