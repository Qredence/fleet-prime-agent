# Fleet Prime Agent

Fleet Prime Agent is Qredence's persistent local workspace for coding and research with AI. It combines a multi-project web chat with the upstream Prime Agent engine, so an agent can work through IPython, shell commands, file edits, plans, and subagents while sessions remain available after you close the browser.

[![CI](https://github.com/Qredence/fleet-prime-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Qredence/fleet-prime-agent/actions/workflows/ci.yml)
[![Discord](https://shieldcn.dev/discord/1316199667142496307.svg?statusDot=true)](https://discord.gg/ebgy7gtZHK)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)



https://github.com/user-attachments/assets/0e74d3cd-d3b4-49a9-a01e-7ac2a1427309





## Install

Clone the repository and run the Fleet Prime installer command. It installs the root and web dependencies, builds Fleet Prime, and links the `fleet-prime` and `prime-agent` commands.

```bash
git clone https://github.com/Qredence/fleet-prime-agent.git
cd fleet-prime-agent
./fleet-prime.sh install
```

The installer uses pnpm 11 for the web workspace when a compatible system version is unavailable.

## Start your workspace

Run Fleet Prime from the project directory you want the agent to work in:

```bash
cd /path/to/your/project
fleet-prime
```

Open the local URL printed by the launcher. On first use, add a provider in **Settings → Providers** (or run `/login`) and choose a model in the composer.

Use the terminal interface instead when you prefer a TUI:

```bash
prime-agent
```

## What it does

- Keeps project sessions, attachments, and workspace navigation in a local web interface.
- Streams agent work as dedicated cards for IPython, shell commands, edits, plans, subagents, and interactive questions.
- Gives the agent a persistent IPython environment for file operations, command execution, and tool use.
- Supports recursive subagents, executable skills, and the `/refine` self-improvement workflow.

## Requirements

- Node.js 22.8.0 or later
- npm 11.10 or later
- Git
- Python 3.10 or later for the managed IPython kernel

## Develop from source

The upstream engine uses the root npm workspace; Fleet's web product uses the isolated pnpm workspace in `web/`.

```bash
npm ci
pnpm install --dir web
pnpm --dir web --filter @prime-agent/web dev
```

Always run pnpm with `--dir web`. Running pnpm at the repository root rewrites the root dependency layout, replaces in-tree workspace links, and is unsupported.

For validation, run `npm run check`. Run focused tests from the relevant package root, for example:

```bash
cd packages/coding-agent
npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts
```

## Documentation and contribution

- [Wiki](https://github.com/Qredence/fleet-prime-agent/wiki) — browsable documentation
- `packages/coding-agent/docs/index.md` — engine documentation index
- `web/app/ARCHITECTURE.md` — web application architecture and HTTP API
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution process
- [SUPPORT.md](SUPPORT.md) — support and community channels

Read `AGENTS.md` before opening a pull request. It defines development, validation, and upstream-sync rules.

## Security

Fleet Prime executes model-generated Python and project commands with your user permissions. Worker and kernel processes improve lifecycle isolation and recovery; they are not a security sandbox. Use trusted repositories, instructions, skills, and extensions, and review changes before accepting them. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Upstream engine

`packages/*` and `prime-agent-runtime/` are verbatim copies of the Prime Agent release pinned in [UPSTREAM](UPSTREAM). Do not edit them locally. Maintainers update the engine with `node scripts/sync-upstream.mjs --apply <tag>` and review the Fleet adapter in the same change.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

Fleet Prime Agent is powered by [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent), whose lineage includes [pi-mono](https://github.com/badlogic/pi-mono) by Mario Zechner. Thanks to the Prime Intellect team and the contributors who shaped that engine.
