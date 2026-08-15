# Prime Agent Documentation

Prime Agent is an RLM-native coding and research harness built around a persistent IPython kernel, recursive subagents, durable sessions, and a multi-process local runtime. It began as a hard fork of pi-mono, but Prime Agent is now the product, CLI, install source, and development repository.

## Quick Start

Install from the public Qredence repository on Linux or macOS:

```bash
mkdir -p fleet-prime-agent && cd fleet-prime-agent && \
curl -fsSL https://raw.githubusercontent.com/Qredence/fleet-prime-agent/main/install.sh | sh
```

Then run it in a project directory:

```bash
cd /path/to/project
prime-agent
```

Run the packaged web frontend and backend with:

```bash
fleet-prime
```

The installer clones or reuses `Qredence/fleet-prime-agent` in the current directory, builds the web runtime, and links `prime-agent` globally. The source Prime Agent packages remain at their repository version; no upstream PrimeIntellect account, release, or repository access is required.

Authenticate with `/login` for subscription or stored API-key providers, or set an environment variable such as `ANTHROPIC_API_KEY` before launch. See the [Quickstart](quickstart.md) for the complete first-run flow.

The public repository is the canonical install source. The inherited npm workspace names in the source tree are implementation details, while the linked user-facing command is `prime-agent`.

## Start Here

- [Quickstart](quickstart.md) - install, authenticate, and run a first session.
- [Using Prime Agent](usage.md) - interactive mode, RLM subagents, slash commands, context files, and CLI reference.
- [Architecture overview](architecture.md) - client, daemon, worker, session, kernel, provider, and storage boundaries.
- [RLM programming model](rlm.md) - programmatic execution, native subagents, Python skills, and durable state.
- [Long-running and background agents](long-running-agents.md) - daemon workers, messaging, heartbeats, goals, schedules, and autonomous mode.
- [Providers](providers.md) - subscription and API-key setup for built-in providers.
- [Settings](settings.md) - global and project settings.
- [Keybindings](keybindings.md) - default shortcuts and custom keybindings.
- [Sessions](sessions.md) - session management, branching, and tree navigation.
- [Compaction](compaction.md) - context compaction and branch summarization.

## Customization

- [Extensions](extensions.md) - TypeScript modules for tools, commands, events, and custom UI.
- [Skills](skills.md) - markdown and Python-backed skills, including how to ask Prime Agent to create them.
- [MCP integrations](mcp-integrations.md) - use MCP servers through Python skills without expanding the model's tool surface.
- [Prompt templates](prompt-templates.md) - reusable prompts that expand from slash commands.
- [Themes](themes.md) - built-in and custom terminal themes.
- [Prime Agent packages](packages.md) - bundle and share extensions, skills, prompts, and themes.
- [Custom models](models.md) - add model entries for supported provider APIs.
- [Custom providers](custom-provider.md) - implement custom APIs and OAuth flows.

## Programmatic Usage

- [SDK](sdk.md) - embed Prime Agent in Node.js applications.
- [ACP mode](acp.md) - drive Prime Agent from any Agent Client Protocol client.
- [RPC mode](rpc.md) - integrate over stdin/stdout JSONL.
- [JSON event stream mode](json.md) - print mode with structured events.
- [TUI components](tui.md) - build custom terminal UI for extensions.

## Reference

- [Session format](session-format.md) - JSONL session file format, entry types, and SessionManager API.
- [CLI package reference](../README.md) - complete user and CLI reference.

## Platform Setup

- [Windows](windows.md)
- [Termux on Android](termux.md)
- [tmux](tmux.md)
- [Terminal setup](terminal-setup.md)
- [Shell aliases](shell-aliases.md)

## Development

- [Development](development.md) - local setup, configuration, debugging, and validation.
- [Architecture overview](architecture.md) - system topology and end-to-end prompt flow.
- [Daemon Architecture](daemon.md) - supervisor, catalog, worker, lifecycle, and recovery details.
- [Agent Connection Architecture](agent-connection.md) - client/runtime connection boundary.
- [RLM Runtime Architecture](rlm-runtime.md) - ZeroMQ kernel transport and recursive subagent execution.
