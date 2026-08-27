# Development Rules

## Conversational Style

- No fluff or cheerful filler text
- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Web interface (`web/`)

This repo's web UI is the standalone Qredence product. It is not merged into
upstream `PrimeIntellect-ai/prime-agent`. The stock upstream `prime-agent`
package is the execution runtime; the web stack is the interface.

- Interface: `web/app` (TanStack Start) + `web/design`
- Adapter: `web/server` (`prime-bridge.ts`, `event-mapper.ts`, HTTP handlers)
- Contract: `web/protocol/src/chat-protocol.ts`
- Browser code talks HTTP (NDJSON + SSE) only. Do not import `prime-agent`
  from `web/app/src` or `web/design`.
- `web/server` is the only adapter layer that imports `prime-agent`; it owns
  the daemon connection, event mapping, and runtime compatibility.

`PRIME_AGENT_RUNTIME.json` pins the stock upstream tarball and SHA-256.
`packages/fleet-prime` is Fleet's thin launcher package; it is not an upstream
source checkout. Do not add copies of upstream source under `packages/` or
`prime-agent-runtime/`.

Install: `npm install` at the repo root, then `pnpm install` in `web/`. Never
`npm install` inside `web/`, and never `pnpm install` at the repo root.
pnpm 11 settings live in `web/pnpm-workspace.yaml` (not `.npmrc`).

Running pnpm at the repo root (instead of `--dir web`) rewrites the root
`node_modules` to a pnpm layout and drops a stray
`pnpm-workspace.yaml` (with placeholder `allowBuilds` values) and
`pnpm-lock.yaml` at the root. If this happens, delete those two files and
re-run `npm install` at the root. Never commit them.

The web server consumes the same pinned `prime-agent` package as the Fleet
launcher. Keep its tarball URL and version aligned with
`PRIME_AGENT_RUNTIME.json`.

Dev: `pnpm --dir web --filter @prime-agent/web dev` (or `npm run dev:web`).

## Code Quality

- Read files in full before making wide-ranging changes, before editing files you have not already fully inspected, and when the user asks you to investigate or audit something. Do not rely only on search snippets for broad changes.
- Don't be too verbose with comments in the code. Only write comments when there is serious ambiguity
- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Do not preserve backward compatibility unless the user explicitly asks for it
- Never hardcode key checks with, eg. `matchesKey(keyData, "ctrl+x")`. All keybindings must be configurable. Add default to matching object (`DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`)
- Do not add or restore vendored Prime Agent source trees. Engine behavior,
  providers, models, and daemon protocol changes belong upstream.

## Upstream runtime upgrades

Prime Agent is consumed as a stock, checksum-pinned release tarball rather than
vendored source. To upgrade it, update `PRIME_AGENT_RUNTIME.json` and the
matching dependency URLs, run `npm install` plus `pnpm --dir web install`, then
run `node scripts/check-prime-agent-runtime.mjs`, web-server type checks, and
the adapter parity tests. Review changes to the public runtime APIs consumed by
`web/server` and the daemon protocol before merging. Do not patch upstream code
inside this repository.

## Commands

- After code changes (not documentation changes): `npm run check` (get full output, no tail). Fix all errors, warnings, and infos before committing.
- `check:runtime` runs first inside `npm run check` and verifies the pinned
  runtime manifest.
- Note: `npm run check` does not run tests.
- NEVER run: `npm run dev`, `npm run build`, `npm test`
- Only run specific tests if user instructs: `npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts`
- Run tests from the package root, not the repo root.
- If you create or modify a test file, you MUST run that test file and iterate until it passes.
- When writing tests, run them, identify issues in either the test or implementation, and iterate until fixed.
- Use the web-server's deterministic test doubles for adapter tests. Do not use
  real provider APIs, real API keys, or paid tokens.

## Daemon Protocol Changes

The daemon protocol is upstream-owned. When a pinned runtime upgrade changes
the protocol or schema revision, review
`web/docs/architecture/fleet-adapter-contract-v1.md`, update `web/server`, and
run the daemon-runtime and bridge parity tests in the same PR.

## Dependencies

- A 7-day minimum release age applies to all dependency updates: `.npmrc` sets `min-release-age=7` and `.github/dependabot.yml` uses a matching `cooldown`. Never bypass it for routine updates.
- Enforcement requires npm >= 11.10; older npm silently ignores the setting, so use a current npm when updating dependencies.
- For an urgent security patch younger than 7 days, override explicitly: `npm install --min-release-age=0 <pkg>`.

## GitHub Workflow

When creating issues:

- Add the existing labels that best describe the affected Fleet surface.
- If an issue spans multiple surfaces, add all relevant labels.

When posting issue/PR comments:

- Write the full comment to a temp file and use `gh issue comment --body-file` or `gh pr comment --body-file`
- Never pass multi-line markdown directly via `--body` in shell commands
- Preview the exact comment text before posting
- Post exactly one final comment unless the user explicitly asks for multiple comments
- If a comment is malformed, delete it immediately, then post one corrected comment
- Keep comments concise, technical, and in the user's tone

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the commit message
- This automatically closes the issue when the commit is merged

## PR Workflow

- Analyze PRs without pulling locally first
- If the user approves: create a feature branch, pull PR, rebase on main, apply adjustments, commit, merge into main, push, close PR, and leave a comment in the user's tone
- We work in feature branches until everything is according to the user's requirements. Never merge PRs by yourself.

## Testing Prime Agent Interactive Mode with tmux

To test Prime Agent's TUI in a controlled terminal environment:

```bash
# Create tmux session with specific dimensions
tmux new-session -d -s prime-agent-test -x 80 -y 24

# Start the stock upstream Prime Agent CLI
tmux send-keys -t prime-agent-test "prime-agent" Enter

# Wait for startup, then capture output
sleep 3 && tmux capture-pane -t prime-agent-test -p

# Send input
tmux send-keys -t prime-agent-test "your prompt here" Enter

# Send special keys
tmux send-keys -t prime-agent-test Escape
tmux send-keys -t prime-agent-test C-o  # ctrl+o

# Cleanup
tmux kill-session -t prime-agent-test
```

You, yourself, are often running into a tmux session, so be careful when killing tmux sessions. Lots of other processes can be running on different tmux sessions/

## Changelog

Fleet changes are summarized in this repository's PRs and release notes. Do
not add a changelog or change fragment to a copied upstream directory.

## Adding a New LLM Provider

Engine features (providers, models, daemon protocol, CLI behavior) are developed
in `PrimeIntellect-ai/prime-agent`, not here. Contribute there, then update the
pinned stock runtime release and Fleet adapter compatibility checks.

## Releasing

The upstream engine version is pinned in `PRIME_AGENT_RUNTIME.json`; upgrades
are explicit dependency updates with checksum and adapter verification.

Fleet release (web product + packed CLI artifact):

1. Upgrade the runtime pin if needed, then run `npm install`, `pnpm --dir web install`, and `npm run check`.
2. Build and pack: `npm run build && npm run build:web:release && npm run release:pack`.
3. Tag this repository; do not publish Prime Agent itself from Fleet.

## **CRITICAL** Git Rules for Parallel Agents **CRITICAL**

Multiple agents may work on different files in the same worktree simultaneously. You MUST follow these rules:

### Committing

- **ONLY commit files YOU changed in THIS session**
- ALWAYS include `fixes #<number>` or `closes #<number>` in the commit message when there is a related issue or PR
- NEVER use `git add -A` or `git add .` - these sweep up changes from other agents
- ALWAYS use `git add <specific-file-paths>` listing only files you modified
- Before committing, run `git status` and verify you are only staging YOUR files
- Track which files you created/modified/deleted during the session

### Forbidden Git Operations

These commands can destroy other agents' work:

- `git reset --hard` - destroys uncommitted changes
- `git checkout .` - destroys uncommitted changes
- `git clean -fd` - deletes untracked files
- `git stash` - stashes ALL changes including other agents' work
- `git add -A` / `git add .` - stages other agents' uncommitted work
- `git commit --no-verify` - bypasses required checks and is never allowed

### Safe Workflow

```bash
# 1. Check status first
git status

# 2. Add ONLY your specific files
git add web/server/src/prime-bridge.ts
git add web/server/src/__tests__/prime-bridge.test.ts

# 3. Commit
git commit -m "fix(web): description"

# 4. Push (pull --rebase if needed, but NEVER reset/checkout)
git pull --rebase && git push
```

### If Rebase Conflicts Occur

- Resolve conflicts in YOUR files only
- If conflict is in a file you didn't modify, abort and ask the user
- NEVER force push

### User override

If the user instructions conflict with rules set out here, ask for confirmation that they want to override the rules. Only then execute their instructions.
