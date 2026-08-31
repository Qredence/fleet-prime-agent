# Fleet Prime Agent

Fleet Prime Agent is Qredence's persistent local workspace for coding and research with AI. It combines a multi-project web chat with the upstream Prime Agent engine, so an agent can work through IPython, shell commands, file edits, plans, and subagents while sessions remain available after you close the browser.

[![CI](https://github.com/Qredence/fleet-prime-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Qredence/fleet-prime-agent/actions/workflows/ci.yml)
[![Discord](https://shieldcn.dev/discord/1316199667142496307.svg?statusDot=true)](https://discord.gg/ebgy7gtZHK)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)






https://github.com/user-attachments/assets/7df3d0ea-8c73-40a4-9bd3-f1c0445a9ea8








## Install

Install the npm package (Node.js 22.8.0 or later):

```bash
npm install -g @qredence/fleet
```

Or install from source. Clone the repository and run the Fleet Prime installer command. It installs the pinned upstream Prime Agent runtime, the web dependencies, builds Fleet Prime, and links `fleet-agent`.

```bash
git clone https://github.com/Qredence/fleet-prime-agent.git
cd fleet-prime-agent
./fleet-prime.sh install
```

The installer uses pnpm 11 for the workspace when a compatible system version is unavailable.

## Start your workspace

Run Fleet Prime from the project directory you want the agent to work in:

```bash
cd /path/to/your/project
fleet-agent
```

Open the local URL printed by the launcher. On first use, add a provider in **Settings → Providers** (or run `/login`) and choose a model in the composer.

Use the terminal interface instead when you prefer a TUI:

```bash
prime-agent
```

## Coexistence with an existing `prime-agent` install

Fleet installs as `fleet-agent`; it does not replace or shadow an existing `prime-agent` binary. Both commands share `~/.prime/agent/` settings, kernel venv, and logs.

## What it does

- Keeps project sessions, attachments, and workspace navigation in a local web interface.
- Streams agent work as dedicated cards for IPython, shell commands, edits, plans, subagents, and interactive questions.
- Gives the agent a persistent IPython environment for file operations, command execution, and tool use.
- Supports recursive subagents, executable skills, and the `/refine` self-improvement workflow.

## Requirements

- Node.js 22.8.0 or later
- pnpm 11 (the installer bootstraps it via npm when absent)
- Git
- Python 3.10 or later for the managed IPython kernel

## Develop from source

Fleet resolves the whole workspace (web product, launcher package) with pnpm 11
through the root `pnpm-workspace.yaml` and `pnpm-lock.yaml`.

```bash
pnpm install
pnpm --filter @prime-agent/web dev
```

Never run `npm install` at the repository root; it drops a `package-lock.json`
and rewrites the dependency layout.

For validation, run `pnpm run check`. Run focused tests from the relevant package root, for example:

```bash
cd web/server
pnpm exec vitest run src/__tests__/specific.test.ts
```

## Documentation and contribution

- [Wiki](https://github.com/Qredence/fleet-prime-agent/wiki) — browsable documentation
- [Prime Agent documentation](https://github.com/PrimeIntellect-ai/prime-agent#readme) — engine documentation
- `web/app/ARCHITECTURE.md` — web application architecture and HTTP API
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution process
- [SUPPORT.md](SUPPORT.md) — support and community channels

Read `AGENTS.md` before opening a pull request. It defines development,
validation, and pinned-runtime upgrade rules.

## Security

Fleet Prime executes model-generated Python and project commands with your user permissions. Worker and kernel processes improve lifecycle isolation and recovery; they are not a security sandbox. Use trusted repositories, instructions, skills, and extensions, and review changes before accepting them. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Upstream engine

Fleet does not vendor the Prime Agent engine. [PRIME_AGENT_RUNTIME.json](PRIME_AGENT_RUNTIME.json) pins the upstream release tarball and SHA-256; upgrades update that manifest and must pass the web-server parity tests.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

Fleet Prime Agent is powered by [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent), whose lineage includes [pi-mono](https://github.com/badlogic/pi-mono) by Mario Zechner. Thanks to the Prime Intellect team and the contributors who shaped that engine.
