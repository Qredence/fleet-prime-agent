# Fleet Prime — Agent Instructions

`fleet-prime-agent` is the Fleet Prime product: a standalone web interface and launcher built around a checksum-pinned stock Prime Agent runtime.

Fleet owns the product/interface layer.

Prime Agent owns the execution engine.

This file defines repository-wide execution rules.

## Working model

Before changing code:

1. Inspect the relevant implementation and its tests.
2. Search for existing implementations, types, helpers, and established boundaries before adding new abstractions.
3. Read `ARCHITECTURE.md` when the task affects ownership, lifecycle, runtime boundaries, protocol behavior, sessions, transports, or cross-package behavior.
4. Read a file under `docs/guides/` only when performing the specific operation that guide covers.

Treat current code, tests, workspace configuration, `PRIME_AGENT_RUNTIME.json`, package manifests, and executable validation as authoritative.

Documentation explains the system but does not override executable contracts.

## Execution

For clear, reversible work, inspect the relevant context and proceed.

Prefer the simplest implementation that fully satisfies the request.

Keep changes focused.

Reuse existing modules, types, packages, and abstractions when they fit instead of creating parallel mechanisms.

Remove obsolete, duplicated, or superseded code when its removal is safe, verified, and directly relevant to the task.

For multi-file or architectural work, maintain a concise task list and validate meaningful stages as you go.

Do not modify unrelated files merely to make a diff cleaner.

## Git and external effects

Preserve pre-existing staged, unstaged, and untracked changes.

Do not reset, clean, stash, overwrite, or revert changes you did not make.

Do not use destructive or broad Git operations such as:

```bash
git add .
git add -A
git reset --hard
git clean -fd
git checkout .
git stash
git commit --no-verify
```

When staging is explicitly requested, stage only files changed for the current task.

Do not commit, amend, push, open or merge pull requests, publish packages, create releases, deploy, or perform other externally visible actions unless explicitly requested.

Never force-push.

Never expose credentials, tokens, `.env` values, provider secrets, or private runtime data.

## Product boundary

Fleet Prime is an independent product layer over the stock upstream Prime Agent runtime.

Do not vendor, copy, or patch Prime Agent source into this repository.

Engine behavior such as:

* provider implementations;
* model implementations;
* daemon internals;
* upstream CLI behavior;
* core runtime behavior;
* upstream protocol implementation;

belongs upstream unless Fleet is adapting or presenting an already-supported upstream capability.

`PRIME_AGENT_RUNTIME.json` is the authoritative runtime pin.

When the runtime changes, keep every package reference to the stock runtime aligned with that manifest and follow `docs/guides/upstream-runtime.md`.

Do not encode the currently pinned runtime version into `AGENTS.md` or `ARCHITECTURE.md`.

## Web architecture boundaries

The primary dependency direction is:

```text
browser
  ↓ HTTP / NDJSON / SSE
web/app
  ↓ typed Fleet protocol
web/server
  ↓ supported Prime Agent runtime / daemon API
stock Prime Agent runtime
```

Additional responsibilities:

```text
web/protocol
  → browser-safe transport contracts

web/design
  → reusable Fleet presentation/UI components

packages/fleet-web
  → Fleet launcher/distribution
```

### Browser boundary

`web/app` and `web/design` must not import `prime-agent` or other upstream execution-runtime packages.

Browser code communicates with execution through Fleet's typed HTTP/stream protocol.

Do not expose raw runtime objects to browser code merely because the in-process implementation makes them technically accessible.

### Server boundary

`web/server` is Fleet's adapter boundary to Prime Agent.

It owns:

* runtime/daemon connection;
* Fleet-to-Prime session adaptation;
* upstream event mapping;
* browser-safe presentation mapping;
* HTTP handlers;
* replay infrastructure;
* pending interactions/dialogs;
* Fleet-managed presentation state;
* runtime compatibility handling.

Do not move Prime Agent-specific execution knowledge into `web/app` or `web/design`.

### Protocol boundary

`web/protocol` owns browser-safe wire types.

Server and browser should depend on the shared protocol instead of independently recreating equivalent event shapes.

Protocol evolution should remain additive or explicitly versioned/capability-gated when compatibility requires it.

See `docs/reference/adapter-contract.md` for the durable transport/privacy contract.

## Prime Agent connection invariants

Use the supported Prime Agent connection abstraction rather than bypassing it to access mutable runtime internals.

Fleet/client code should operate through supported connection/session projection surfaces.

Do not reintroduce direct raw `AgentSession`, `SessionManager`, extension-runtime, or equivalent mutable runtime access across the Fleet boundary when a supported connection abstraction exists.

Session replacement behavior should use supported replacement hooks/options rather than leaking runtime ownership across the client boundary.

Keep process-local executable/runtime capabilities process-local.

Do not invent browser or wire representations for executable callbacks purely to expose internal convenience APIs.

## Privacy and reasoning

Raw detailed model reasoning is not a normal Fleet browser presentation surface.

Do not expose raw detailed thinking through:

* browser event streams;
* standard message parts;
* transcript hydration;
* assistant-text fallback;
* copy/export behavior;
* ordinary diagnostics.

Fleet may expose controlled browser-safe reasoning/execution presentation derived from typed lifecycle information.

Do not infer new user-visible execution semantics from arbitrary model text when the runtime does not provide an authoritative typed signal.

## TypeScript and imports

Prefer precise types.

Avoid `any`; use it only where an external boundary genuinely cannot be expressed more precisely, and isolate it narrowly.

Inspect installed dependency type definitions instead of guessing external APIs.

Use normal top-level imports.

Do not use dynamic or inline imports as a general code-organization mechanism.

Dynamic imports are acceptable only for intentional lazy/bundle boundaries where they materially affect browser loading or bundle constraints.

Keep configurable interaction behavior configurable.

Do not hardcode keybinding checks where the existing configurable keybinding system can express the behavior.

## Dependencies and installation

Use pnpm for the repository workspace.

From the repository root:

```bash
pnpm install
```

Do not run root:

```bash
npm install
npm ci
```

Do not introduce or commit a root `package-lock.json`.

Respect the workspace dependency minimum-release-age policy.

Do not bypass it for routine dependency updates.

A younger dependency should require an explicit reviewed reason such as an urgent security remediation.

## Testing

Use deterministic local test doubles for Fleet adapter/runtime tests.

Do not use real provider APIs, API keys, paid model calls, or user credentials for ordinary tests.

When modifying a test file, run that test.

When behavior changes, run focused tests that prove the affected behavior rather than relying only on static checking.

Run tests from the owning workspace or through an explicit workspace filter.

## Changesets

User-visible changes to the published `@qredence/fleet` package require a Changeset unless the change is documentation-only, CI-only, or internal and does not affect the released package.

Do not maintain a second hand-written Fleet changelog mechanism.

Prime Agent engine release notes belong upstream.

## Repository map

* `web/app/` — TanStack Start browser product.
* `web/server/` — Fleet adapter to Prime Agent and HTTP/runtime orchestration.
* `web/protocol/` — typed browser/server protocol.
* `web/design/` — reusable Fleet UI and presentation components.
* `packages/fleet-web/` — published launcher/distribution package.
* `scripts/` — repository validation, packaging, installation, and release tooling.
* `PRIME_AGENT_RUNTIME.json` — authoritative stock Prime Agent runtime pin.
* `docs/reference/` — durable technical contracts.
* `docs/guides/` — operation-specific runbooks.

Extend the owning package rather than creating a second location for the same responsibility.

## Validation

Use the smallest validation lane that proves the change, then escalate when the affected contract requires it.

### Normal code changes

Run:

```bash
pnpm run check
```

This is the primary static repository gate.

It validates the runtime manifest, formatting/linting, installer structure, rendering constraints, and TypeScript workspaces.

It does not replace behavioral tests.

Also run focused tests for changed behavior.

### Focused tests

Use the affected workspace.

Examples:

```bash
pnpm --filter @prime-agent/web-server exec vitest run <test-file>
pnpm --filter @prime-agent/web exec vitest run <test-file>
```

Use the corresponding owning package for protocol/design tests.

### Cross-package protocol/runtime changes

For changes spanning protocol, server, and browser behavior, run the relevant focused suites and escalate to:

```bash
pnpm run check
pnpm run test:web
```

when the broader web suite materially validates the change.

### Runtime-pin changes

Follow:

```text
docs/guides/upstream-runtime.md
```

and run the runtime-manifest verification and compatibility tests specified there.

### Release/package changes

Use repository package/release checks only when the task affects packaging, installation, release output, or release readiness.

Do not run publish/release operations merely as validation.

### Development servers and live providers

Do not start long-running development servers or make live provider/model calls unless they are required for the task or explicitly requested.

## Completion

Before finishing:

1. Review the diff for unintended changes.
2. Run every applicable validation lane.
3. Run:

```bash
git diff --check
```

4. Report:

   * what changed;
   * checks/tests run;
   * anything not validated;
   * whether live/provider/release validation was intentionally not run.

Do not claim behavioral correctness from static checks alone.
