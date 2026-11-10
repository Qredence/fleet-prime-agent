# Fleet Prime — Agent Instructions

`fleet-prime-agent` is the Fleet Prime product: a standalone web interface and CLI launcher (`@qredence/fleet`) built around a checksum-pinned stock Prime Agent runtime. Fleet owns the product, browser UI, server adapter, transport contracts, and distribution launcher; Prime Agent owns the execution engine.

This file defines the repository-wide engineering and agent execution contract.

## Working model & execution

Before changing code:

1. Inspect the relevant implementation and its tests.
2. Search for existing implementations, types, helpers, and established boundaries before adding new abstractions.
3. Read `ARCHITECTURE.md` when the task affects ownership, lifecycle, runtime boundaries, protocol behavior, sessions, transports, or cross-package behavior.
4. Read a runbook under `docs/guides/` (`upstream-runtime.md`, `releasing.md`, `tmux-testing.md`, `react-doctor.md`) only when performing the specific operation it covers.

Treat current code, tests, workspace configuration, `PRIME_AGENT_RUNTIME.json`, package manifests, and executable validation as authoritative. Documentation explains the system but never overrides executable contracts.

For codebase-analysis claims, cite the relevant source and distinguish configured values (`rust.version` vs. legacy top-level `version` in `PRIME_AGENT_RUNTIME.json`), observed behavior, and inference. Never describe a configured runtime pin as the active daemon version without evidence from that daemon.

Execution principles:

- For clear, reversible work, inspect the relevant context and proceed with the simplest focused implementation that fully satisfies the request.
- Reuse existing modules, types, packages, and abstractions instead of creating parallel mechanisms.
- Remove obsolete, duplicated, or superseded code when its removal is safe, verified, and directly relevant to the task.
- Do not modify unrelated files merely to make a diff cleaner.
- For multi-file or architectural work, maintain a concise task list and validate meaningful stages as you go.

## Git, secrets, and external effects

- Preserve pre-existing staged, unstaged, and untracked changes. Never reset, clean, stash, overwrite, or revert changes you did not make.
- Never run destructive or broad Git commands (`git add .`, `git add -A`, `git reset --hard`, `git clean -fd`, `git checkout .`, `git stash`, `git commit --no-verify`, or any force-push).
- When staging is explicitly requested, stage only files changed for the current task.
- Do not commit, amend, push, open or merge pull requests, publish packages, create releases, deploy, start long-running dev servers, or make live provider/model calls unless explicitly requested or required by the task.
- Never expose credentials, tokens, `.env` values, provider secrets, or private runtime data. Server-only API keys (such as `THESYS_API_KEY` or the TypeSafe key) must stay unprefixed (never `VITE_*`) and must never be returned, logged, or echoed in browser projections.

## Product & runtime boundary

Fleet Prime is an independent product layer over the stock upstream Prime Agent runtime. Do not vendor, copy, or patch Prime Agent source into this repository. Engine behavior (providers, models, daemon internals, upstream CLI, core runtime, and upstream wire protocol) belongs upstream unless Fleet is adapting or presenting an already-supported upstream capability.

`PRIME_AGENT_RUNTIME.json` is the authoritative runtime pin:

- `rust` pins the native Rust daemon (`rust.version`, `rust.baseUrl`, and per-target `archive`, `sha256`, and `executableSha256` for `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`). `ensurePrimeRuntime` (`packages/fleet-web/bin/prime-runtime.mjs`) verifies both digests before installing under `~/.prime/fleet/runtimes/<version>/<target>`, and `web/server/src/daemon-runtime.ts` spawns the native binary directly (`prime-agent --mode daemon --daemon-socket <socket>` or `FLEET_PRIME_AGENT_BIN`).
- Top-level fields (`package`, `version`, `tarball`, `sha256`) pin the legacy TypeScript SDK release family (`prime-agent`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`) while the remaining R1b compatibility surface is retired, and must stay synchronized across `packages/fleet-web/package.json`, `web/server/package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`.

When updating the runtime pin, follow `docs/guides/upstream-runtime.md`. Do not encode the currently pinned runtime version into `AGENTS.md` or `ARCHITECTURE.md`.

## Repository map & architecture boundaries

```text
browser
  ↓ HTTP / NDJSON (active turn) / SSE (out-of-turn & replay)
web/app (@qredence/web)
  ↓ shared web/protocol contracts + server-only route delegation
web/server (@prime-agent/web-server)
  ↓ FleetAgentConnection port / protocol-7 Rust daemon socket
stock Prime Agent runtime
```

- `web/app/` (`@qredence/web`) — TanStack Start browser product (React 19 with React Compiler): routes, UI components, styles, client state, and app-owned checks (`scripts/`, `playwright/`).
- `web/server/` (`@prime-agent/web-server`) — Fleet adapter to Prime Agent: daemon connection, session adaptation, event mapping, sanitization, HTTP handlers, SSE replay, and Fleet presentation sidecars.
- `web/protocol/` (`@prime-agent/web-protocol`) — Shared browser-safe wire contracts and Zod schemas (`ChatStreamEvent`, OpenUI tools/dashboards, composer intent/completion, session/MCP projections).
- `packages/fleet-web/` (`@qredence/fleet`) — Published CLI launcher (`fleet-agent` / `fleet-prime`) and runtime installer.
- `scripts/` — Repository quality gates, boundary checks, packaging, source installer, and release tooling.
- `docs/reference/` & `docs/guides/` — Durable contracts (`adapter-contract.md`), ADRs (`docs/adr/`), and operation runbooks.

Extend the owning package rather than creating a second location for the same responsibility.

### Browser & UI boundary (`web/app`)

- `web/app` must never import `prime-agent`, `@earendil-works/pi-*`, or server-only SDKs (such as `@typesafe-ai/sdk`). Browser code communicates with execution exclusively through Fleet's typed HTTP/stream protocol; never expose raw runtime objects or executable callbacks to browser code.
- Product UI composition is defined in `web/app/src/components/README.md` and layout/typography tokens in `web/app/LAYOUT.md` (enforced by `scripts/check-web-boundaries.mjs` and `web/app/scripts/component-contract-check.ts`):
   - Product folders (`chat`, `sessions`, `workspace`, `artifacts`, `settings`, `tools`, `agents`, `connectors`, `dashboards`, `layout`) compose `components/ui` via exact `@/components/ui/<file>` imports (no relative imports into `ui/` or barrel files) and must not grow a parallel Button, Trace, Dialog, or Input, or add unapproved native `<button>`/`<input>`/`<select>`/`<textarea>` controls.
   - `@base-ui/react` imports stay inside `src/components/ui/`; motion-only helpers stay in `src/components/motion/`; icons use `lucide-react` only.
   - Keep non-conventional file basenames unique across `web/app/src/` ("one name, one home"), leave no dead unreferenced files (unless waived in `web/app/doctor.config.jsonc`), keep exported `*Props` types within 12 top-level fields (unless exempted in `web/app/component-sources.json`), and use named typography classes (`text-micro`, `text-caption`, `text-label`, `text-body`, `text-headline`) rather than arbitrary `text-[0....]` sizes outside `openui/`.

### Server & connection boundary (`web/server`)

- `web/server` terminates all Prime Agent-specific runtime knowledge. Production drives only the native Rust daemon (`isCompatibleDaemonHello` in `web/server/src/daemon-protocol.ts` requires protocol 7, schema revision 30, and the Rust flavor; TypeScript daemons are refused).
- Program against the narrow `FleetAgentConnection` port (`web/server/src/agent-connection-port.ts`), implemented by `FleetDaemonAgentConnection` in production and `in-process-test-connection.ts` in deterministic tests. Do not reintroduce direct raw `AgentSession`, `SessionManager`, extension-runtime, or process-local capability access across the Fleet boundary, and use supported connection replacement hooks for session invalidation/replacement.
- `web/server/src/legacy/prime-agent-sdk.ts` is the only server module that may import the legacy TypeScript SDK's `SettingsManager`, `AuthStorage`, `DefaultResourceLoader`, and read-only session parser (`readLegacySession`), plus re-export the upstream `AgentConnection` type for port signature derivation. Never use mutating transcript openers (such as `SessionManager.openAsync`) on daemon-owned session files. The model catalog is served by the Rust daemon (`get_model_catalog`, cached in `model-catalog-cache.ts`), and agent-dir resolution lives in `web/server/src/agent-dir.ts`. Other SDK imports in `web/server/src` are frozen in `scripts/server-sdk-imports.baseline.json` (ratchet only shrinks; `pnpm run check` fails on new imports).
- Fleet-managed presentation sidecars (artifacts, RLM/user-bash/refinements, `openui-dashboard` records, and message-keyed Plan-mode presentations) are schema-validated and persisted separately from upstream transcripts. OpenUI tool dispatch (`/api/chat/openui/tool`) is strictly read-only and schema-validated.

### Protocol, privacy & reasoning boundary (`web/protocol`)

- Server and browser must share `web/protocol` types instead of recreating wire shapes independently. Protocol evolution must remain additive or explicitly versioned/capability-gated (see `docs/reference/adapter-contract.md`).
- Runtime-provided detailed reasoning is presented only through dedicated typed reasoning events and transcript parts—kept separate from assistant answer text, ordinary copy/export, `session_outputs` rows, unrelated payloads, and diagnostics, without a separate reasoning store.
- Controlled reasoning/execution status summaries derive strictly from typed runtime lifecycle signals (`reasoning-summary-v1`). Never infer user-visible execution semantics from arbitrary model prose.

## TypeScript, formatting & dependencies

- Prefer precise types and inspect installed `.d.ts` definitions instead of guessing external APIs. Avoid `any`; isolate it narrowly only where an external boundary cannot be expressed more precisely.
- Use normal top-level static imports. Dynamic `import()` is allowed only for intentional lazy/bundle boundaries that materially affect browser loading or bundle budgets.
- Keep configurable interaction behavior (such as keybindings) driven by the configurable keybinding system rather than hardcoded checks.
- Formatting and linting use **Oxfmt** (`.oxfmtrc.json`) and **Oxlint** (`.oxlintrc.json`, `--deny-warnings`). Typechecking uses `tsgo --noEmit`.
- Manage workspace dependencies from the repository root with `pnpm install`. Never run root `npm install` or `npm ci`, and never introduce a root `package-lock.json`.
- Respect `minimumReleaseAge: 10080` (7 days) and `trustPolicy: no-downgrade` in `pnpm-workspace.yaml`. Do not bypass them for routine updates; younger dependencies require an explicit reviewed justification such as an urgent security fix.

## Changesets

- User-visible changes to the published `@qredence/fleet` package require a Changeset (`pnpm changeset`) unless the change is documentation-only, CI-only, or purely internal.
- Changeset bodies become the published GitHub release notes (`scripts/release-notes.mjs`); write them for users deciding whether to upgrade. Do not hand-maintain `CHANGELOG.md`, and keep Prime Agent engine release notes upstream.

## Testing & validation

Use deterministic local test doubles and recorded daemon-frame fixtures (`web/server/src/__tests__/fixtures/daemon-frames/`) for adapter and runtime tests. Never use real provider APIs, API keys, paid model calls, or user credentials in ordinary tests.

Use the smallest validation lane that proves the change, then escalate when the affected contract requires it:

1. **Primary static gate (all code changes)**:
   ```bash
   pnpm run check
   ```
   Orchestrated by `scripts/check.mjs`: validates `PRIME_AGENT_RUNTIME.json` (`check:runtime`), `oxfmt --check`, and `oxlint --deny-warnings`, then concurrently runs `check-web-boundaries.mjs` (forbidden browser imports, named type scale, server SDK import ratchet), `check-browser-smoke.mjs` (esbuild browser import graph), `check-source-installer.mjs --static`, `web/app/scripts/render-checks.mjs` (message identities, OpenUI contract/render, component contracts, agent-plan contract, component registries), and workspace `tsgo` typechecking (`check:web`). Run `pnpm run format` only when intentionally writing Oxfmt/Oxlint fixes.
2. **Focused behavioral tests (required whenever behavior or tests change)**:
   ```bash
   pnpm --filter @prime-agent/web-server exec vitest run <test-file>
   pnpm --filter @qredence/web exec vitest run <test-file>
   pnpm --filter @prime-agent/web-protocol exec vitest run <test-file>
   pnpm run test:release
   ```
3. **Cross-package protocol/runtime changes**: run focused suites across the affected workspaces and escalate to `pnpm run check && pnpm run test:web`.
4. **Runtime-pin changes**: follow `docs/guides/upstream-runtime.md` and run its manifest verification and daemon-frame contract replay suites.
5. **Packaging & release changes**: run `pnpm run check:changeset`, `pnpm run test:release`, and when packaging/build output is affected, `pnpm run build:web:release && pnpm run check:package && pnpm run check:web:release`. Never run publish/release operations as validation.

## Completion

Before finishing:

1. Review `git status` and `git diff` for unintended changes.
2. Run every applicable validation lane (static checks alone do not prove behavioral correctness).
3. Run `git diff --check`.
4. Report:
   - what changed;
   - checks and tests run;
   - anything not validated;
   - whether live/provider/release validation was intentionally not run.
