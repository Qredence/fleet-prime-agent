# Fleet Prime Agent

Fleet Prime is a local, multi-project workspace for coding and research with AI.
It combines a focused web interface with the stock [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)
runtime, keeping sessions, workspace navigation, live tool activity, and managed
execution together on your machine.

[![CircleCI](https://dl.circleci.com/status-badge/img/gh/Qredence/fleet-prime-agent/tree/main.svg?style=shield)](https://app.circleci.com/pipelines/github/Qredence/fleet-prime-agent)
[![Discord](https://shieldcn.dev/discord/1316199667142496307.svg?statusDot=true)](https://discord.gg/ebgy7gtZHK)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

![Fleet Prime workspace](https://github.com/user-attachments/assets/7df3d0ea-8c73-40a4-9bd3-f1c0445a9ea8)

## Quick start

### Install the package

Fleet supports macOS and Linux; Windows is not supported. You need Node.js
22.12.0 or later, and Python 3.10 or later for the managed IPython kernel.

```bash
npm install --global @qredence/fleet
```

### Launch the web workspace

Run Fleet from the project directory you want the agent to work in:

```bash
cd /path/to/your/project
fleet-agent
```

Open the loopback URL printed by the launcher. On first use, add a provider in
**Settings → Providers** (or run `/login`) and choose a model in the composer.

`fleet-prime` is an alias for the web launcher.

### Terminal mode

Run the terminal interface with:

```bash
fleet-agent agent
```

An existing `prime-agent` installation remains untouched. Fleet uses the same
upstream settings, kernel environment, and logs.

## Install from source

Use the source installer when you want to develop Fleet or run the repository
checkout directly:

```bash
git clone https://github.com/Qredence/fleet-prime-agent.git
cd fleet-prime-agent
./fleet-prime.sh install
```

The installer installs workspace dependencies, builds the web runtime, and
places a `fleet-agent` launcher in a user-writable bin directory. If that
directory is not already on your `PATH`, the installer prints the path to add.
Source installation also requires Git, Node.js, and npm.

## What Fleet provides

- A local workspace for multiple projects and persistent sessions.
- Streaming assistant responses and dedicated activity for shell commands,
  file edits, plans, questions, and subagents.
- A managed IPython environment for interactive analysis and file operations.
- Attachments, generated artifacts, workspace browsing, and session history.
- Plan, refinement, and provider configuration flows through the web interface.

## Develop

Install the repository workspace with pnpm:

```bash
pnpm install
```

Start the web application in development mode:

```bash
pnpm run dev:web
```

Run the repository checks and tests before submitting a change:

```bash
pnpm run check
pnpm run test:web
```

Use pnpm for the repository workspace. Do not run `npm install` or `npm ci` at
the repository root; those commands create an unsupported dependency layout.
Contributors should read [CONTRIBUTING.md](CONTRIBUTING.md) and
[AGENTS.md](AGENTS.md) before opening a pull request.

## Architecture

Fleet owns the product and adapter layers; Prime Agent remains the external
execution engine. The browser communicates with Fleet through typed HTTP,
NDJSON, and SSE contracts, while runtime access stays in `web/server`.

The pinned runtime release and checksum are maintained in
[PRIME_AGENT_RUNTIME.json](PRIME_AGENT_RUNTIME.json).

## Security

Fleet runs locally and the web launcher accepts loopback connections only. It
can execute model-generated Python and project commands with your user
permissions; it is not a security sandbox. Use trusted repositories,
instructions, skills, and extensions, and review changes before accepting
them. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Documentation and support

- [Architecture](ARCHITECTURE.md) — system ownership and data flow.
- [Adapter contract](docs/reference/adapter-contract.md) — browser/server
  compatibility, replay, and privacy guarantees.
- [Contributing](CONTRIBUTING.md) — development and pull request process.
- [Release guide](docs/guides/releasing.md) — Changesets, publishing, and
  rollback.
- [Support](SUPPORT.md) — questions, bugs, and community channels.
- [Prime Agent documentation](https://github.com/PrimeIntellect-ai/prime-agent#readme)
  — upstream engine documentation.

## License

Fleet Prime Agent is released under the [MIT License](LICENSE).

Fleet is powered by [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent),
whose lineage includes [pi-mono](https://github.com/badlogic/pi-mono) by Mario
Zechner.
