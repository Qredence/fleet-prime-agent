# Fleet Prime Agent

Fleet Prime is a local workspace for coding and research with AI. Open a project
in your browser, chat with an agent, and follow its work as it reads files, runs
commands, and produces results. Fleet provides the interface and runs the stock,
**Rust-based [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)
0.10+ runtime**. The exact version is pinned in
[PRIME_AGENT_RUNTIME.json](PRIME_AGENT_RUNTIME.json).

[![Discord](https://shieldcn.dev/discord/1316199667142496307.svg?statusDot=true)](https://discord.gg/ebgy7gtZHK)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CircleCI](https://dl.circleci.com/status-badge/img/circleci/SomxVLJYMpo86z6XUrZBUq/77Axvw4aep78EpwCW6Nsyh/tree/main.svg?style=svg)](https://dl.circleci.com/status-badge/redirect/circleci/SomxVLJYMpo86z6XUrZBUq/77Axvw4aep78EpwCW6Nsyh/tree/main)

https://github.com/user-attachments/assets/3ea9344f-cb32-4568-a2ef-2012aa79e139

## What you can do

- Work across projects and return to persistent sessions from the sidebar.
- Watch responses and tool activity as the agent works, including commands,
  file edits, plans, questions, and subagents.
- Browse workspace files, attach material to a conversation, and inspect
  generated artifacts.
- Use a managed IPython environment for interactive analysis and file operations.
- Configure providers and models, and use planning and refinement flows in the
  web interface.

## Get started

### Requirements

- macOS or Linux on an x64 or ARM64 machine. Windows is not supported.
- Node.js 22.12.0 or later.
- Python 3.10 or later for the managed IPython kernel.

### Install and launch

Install Fleet globally:

```bash
npm install --global @qredence/fleet
```

Start Fleet from the project directory you want to work in:

```bash
cd /path/to/your/project
fleet-agent
```

Open the local URL printed by the launcher. On first use, add a provider in
**Settings → Providers** or run `/login`, then choose a model in the composer.
Start a conversation by describing what you want to work on. You can return to
your sessions and switch projects from the sidebar.

`fleet-prime` is an alias for `fleet-agent`. To use the upstream terminal
interface instead, run:

```bash
fleet-agent agent
```

## Runtime and troubleshooting

On first launch, Fleet downloads its pinned Prime Agent runtime, verifies its
checksums, and caches it under `~/.prime/fleet/runtimes`. A separately installed
`prime-agent` CLI does not change Fleet's pinned runtime. The pin is recorded in
[PRIME_AGENT_RUNTIME.json](PRIME_AGENT_RUNTIME.json).

Fleet supports existing Prime Agent settings and session data from the earlier
TypeScript-based runtime through a legacy compatibility layer. It runs the
pinned Rust runtime and does not attach to an older TypeScript daemon.

If Fleet reports that its daemon socket is owned by an incompatible daemon,
stop the existing daemon and restart Fleet. Fleet uses a per-user socket under
`$TMPDIR/prime-agent-<uid>`; if socket creation fails because the path is too
long, use a shorter `TMPDIR` such as `/tmp`. An advanced installation can set
`FLEET_PRIME_AGENT_BIN` to use a different native binary.

## Security

Fleet runs locally and the web launcher accepts loopback connections only. The
agent can run model-generated Python and project commands with your user
permissions; Fleet is not a security sandbox. Use trusted repositories,
instructions, skills, and extensions, and review changes before accepting them.
See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Contributing

To develop Fleet, clone the repository, install its workspace dependencies with
pnpm, and start the web application:

```bash
git clone https://github.com/Qredence/fleet-prime-agent.git
cd fleet-prime-agent
pnpm install
pnpm run dev:web
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for requirements, checks, and the pull
request process. The [documentation index](docs/README.md) links to the
architecture, adapter contract, and operation-specific guides.

## Support

- Ask questions or share ideas on [GitHub Discussions](https://github.com/Qredence/fleet-prime-agent/discussions).
- Report bugs through the repository's [issue tracker](https://github.com/Qredence/fleet-prime-agent/issues).
- Read [SUPPORT.md](SUPPORT.md) for community and support options, or the
  [Prime Agent documentation](https://github.com/PrimeIntellect-ai/prime-agent#readme)
  for the upstream engine.

## License

Fleet Prime Agent is released under the [MIT License](LICENSE). Fleet is powered
by [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent), whose lineage
includes [pi-mono](https://github.com/badlogic/pi-mono) by Mario Zechner.

![npm downloads](https://www.npm.bet/svg?q=%40qredence%2Ffleet&timeRange=last-month&grouping=week&metric=downloads&zeroMode=reported)
