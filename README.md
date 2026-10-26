# Fleet Prime Agent

Fleet Prime is a local, multi-project workspace for coding and research with AI.
It combines a focused web interface with the stock [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)
runtime, keeping sessions, workspace navigation, live tool activity, and managed
execution together on your machine.


[![Discord](https://shieldcn.dev/discord/1316199667142496307.svg?statusDot=true)](https://discord.gg/ebgy7gtZHK)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CircleCI](https://dl.circleci.com/status-badge/img/circleci/SomxVLJYMpo86z6XUrZBUq/77Axvw4aep78EpwCW6Nsyh/tree/main.svg?style=svg)](https://dl.circleci.com/status-badge/redirect/circleci/SomxVLJYMpo86z6XUrZBUq/77Axvw4aep78EpwCW6Nsyh/tree/main)




https://github.com/user-attachments/assets/3ea9344f-cb32-4568-a2ef-2012aa79e139



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
upstream settings, kernel environment, and logs. See
[Prime Agent runtime and the local daemon](#prime-agent-runtime-and-the-local-daemon)
for how a global CLI install relates to the runtime Fleet runs.

## Prime Agent runtime and the local daemon

Fleet consumes the stock Prime Agent runtime pinned in
[PRIME_AGENT_RUNTIME.json](PRIME_AGENT_RUNTIME.json). A globally installed
`prime-agent` CLI may also exist on the machine. The two are independent:

- Fleet downloads its pinned Rust runtime on first use, verifies the archive and
  executable checksums, and stores it under `~/.prime/fleet/runtimes`;
- installing, replacing, or removing a global CLI does not change Fleet's pin
  or its cached runtime.

### Daemon socket configuration

Fleet and any `prime-agent` CLI you run each own a daemon process. Fleet
resolves its socket in `web/server/src/daemon-runtime.ts` and uses the shared
per-user path:

- Fleet: `$TMPDIR/prime-agent-<uid>/daemon.sock`
- Migrated Rust CLI launcher: `$TMPDIR/prime-agent-rust-<uid>/daemon.sock`
- Pre-migration TypeScript CLI: `$TMPDIR/prime-agent-<uid>/daemon.sock`

Fleet keeps the shared `$TMPDIR/prime-agent-<uid>` path deliberately. Before
starting a daemon, Fleet probes that socket and only attaches to a Rust daemon
with a compatible protocol and schema. An existing TypeScript daemon is rejected
even if its protocol matches; stop it before starting Fleet.

Because the Rust CLI launcher pins its own `prime-agent-rust-<uid>` namespace,
the CLI daemon and the Fleet daemon are separate processes on separate sockets.
That is expected after a CLI migration and needs no reconciliation. Only
`prime-agent status` (CLI) or Fleet's own connection reports which one is live.

macOS caps AF_UNIX paths at 103 bytes. `$TMPDIR/prime-agent-<uid>/daemon.sock`
plus the longer `worker-<id>-<id>.sock` names must fit, so a deeply nested
`TMPDIR` will fail to bind; the Playwright harness in
`web/app/playwright/hermetic-state.ts` falls back to `/tmp` for this reason.
Keep `TMPDIR` short when running Fleet or the CLI.

### Pointing Fleet at a native binary

By default Fleet provisions and runs its pinned Rust binary. Set
`FLEET_PRIME_AGENT_BIN` to use a different native binary; Fleet runs it as
`<bin> --mode daemon --daemon-socket <socket>` when starting the daemon.
An already-running compatible Rust daemon on the socket is reused.

### Migrating a global CLI install

A globally installed `prime-agent` CLI that predates the Rust rewrite installs
as an npm package and can shadow the newer build on `PATH`. The upstream
installer owns that keyword's lifecycle and takes over the npm package; Fleet
does not, and Fleet's own runtime is unaffected either way. After migrating you
should see:

- `prime-agent --version` reporting the Rust build, resolved from
  `~/.local/bin/prime-agent` rather than an npm-managed bin directory;
- `npm ls -g --depth=0` no longer listing `prime-agent`;
- the old npm-managed tree preserved at `~/.local/share/prime-agent-legacy`
  and `~/.prime/agent` (sessions, settings, kernel venv) untouched.

The installer does not create the daemon socket directory; the daemon creates
it when spawned. An initial `ENOENT` for `daemon.sock` therefore means no
daemon has started yet, not a broken install. Note that the CLI launcher only
uses the `prime-agent-rust-<uid>` namespace when the npm-migration bridge
marker is absent; if `~/.local/share/.prime-agent-npm-bridge/legacy-daemon-socket`
exists, it pins `$TMPDIR/prime-agent-<uid>` instead and will share Fleet's
socket.

## Contribute from source

The global npm package above is the supported installation path for using
Fleet. Clone the repository and use the source installer only when you want to
develop Fleet or validate a repository checkout directly:

```bash
git clone https://github.com/Qredence/fleet-prime-agent.git
cd fleet-prime-agent
./install.sh
```

The source installer installs workspace dependencies, builds the web runtime,
and places a `fleet-agent` launcher in a user-writable bin directory. If that
directory is not already on your `PATH`, the installer prints the path to add.
Source installation requires Git, Node.js, and npm; it uses a compatible system
pnpm 11 installation when present and falls back to `npm exec` otherwise.

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

Internal workspace packages are named `@prime-agent/web-*`. The published
launcher is `@qredence/fleet`. The frontend lives in `web/app` (routes,
components, styles, and browser state); the `pi` name in older Fleet chat code
is historical. See [CONTRIBUTING.md](CONTRIBUTING.md).

The pinned runtime release and checksum are maintained in
[PRIME_AGENT_RUNTIME.json](PRIME_AGENT_RUNTIME.json).

## Security

Fleet runs locally and the web launcher accepts loopback connections only. It
can execute model-generated Python and project commands with your user
permissions; it is not a security sandbox. Use trusted repositories,
instructions, skills, and extensions, and review changes before accepting
them. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Documentation and support

- [Documentation index](docs/README.md) — guides, reference, and ADRs.
- [Architecture](ARCHITECTURE.md) — system ownership and data flow.
- [Adapter contract](docs/reference/adapter-contract.md) — browser/server
  compatibility, replay, and privacy guarantees.
- [Contributing](CONTRIBUTING.md) — development and pull request process.
- [Release guide](docs/guides/releasing.md) — Changesets, CircleCI Smart
  Deployments, and rollback.
- [Support](SUPPORT.md) — questions, bugs, and community channels.
- [Prime Agent documentation](https://github.com/PrimeIntellect-ai/prime-agent#readme)
  — upstream engine documentation.

## License

Fleet Prime Agent is released under the [MIT License](LICENSE).

Fleet is powered by [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent),
whose lineage includes [pi-mono](https://github.com/badlogic/pi-mono) by Mario
Zechner.

## Download Stats

![npm downloads](https://www.npm.bet/svg?q=%40qredence%2Ffleet&timeRange=last-month&grouping=week&metric=downloads&zeroMode=reported)
