# Development Rules

Universal rules for all work in this repository. Area-specific guides live in
`docs/guides/` (see the index at the bottom); read the relevant guide before
working in that area.

## Conversational Style

- No fluff or cheerful filler text
- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Code Quality

- Read files in full before making wide-ranging changes, before editing files you have not already fully inspected, and when the user asks you to investigate or audit something. Do not rely only on search snippets for broad changes.
- Don't be too verbose with comments in the code. Only write comments when there is serious ambiguity
- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports** - no `await import("./foo.js")` in logic, no `import("pkg").Type` in type positions, no dynamic imports for types. Exception: lazy chunk boundaries required by the web bundle budget (`check:bundle`), such as `lazy(() => import(...))` or deferred loaders like `() => import("shiki")`, are allowed. Otherwise always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Do not preserve backward compatibility unless the user explicitly asks for it
- Never hardcode key checks with, eg. `matchesKey(keyData, "ctrl+x")`. All keybindings must be configurable. Add default to matching object (`DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`)
- Do not add or restore vendored Prime Agent source trees. Engine behavior, providers, models, and daemon protocol changes belong upstream.
- Do not import `prime-agent` outside `web/server`. Browser code (`web/app`, `web/design`) talks HTTP only. See `docs/guides/web-interface.md`.

## Commands

- After code changes (not documentation changes): `npm run check` (get full output, no tail). Fix all errors, warnings, and infos before committing.
- `check:runtime` runs first inside `npm run check` and verifies the pinned runtime manifest.
- Note: `npm run check` does not run tests.
- NEVER run: `npm run dev`, `npm run build`, `npm test`
- Only run specific tests if user instructs: `npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts`
- Run tests from the package root, not the repo root.
- If you create or modify a test file, you MUST run that test file and iterate until it passes.
- When writing tests, run them, identify issues in either the test or implementation, and iterate until fixed.
- Use the web-server's deterministic test doubles for adapter tests. Do not use
  real provider APIs, real API keys, or paid tokens.

## Installs

- Repo root: `npm install` only. `web/`: `pnpm install` only. Never `npm install` inside `web/`, never `pnpm install` at the repo root.
- A pnpm run at the repo root drops a stray `pnpm-workspace.yaml` and `pnpm-lock.yaml` at the root: delete both, re-run `npm install` at the root, never commit them. Full recovery steps: `docs/guides/web-interface.md`.

## Dependencies

- A 7-day minimum release age applies to all dependency updates: `.npmrc` sets `min-release-age=7` and `.github/dependabot.yml` uses a matching `cooldown`. Never bypass it for routine updates.
- Enforcement requires npm >= 11.10; older npm silently ignores the setting, so use a current npm when updating dependencies.
- For an urgent security patch younger than 7 days, override explicitly: `npm install --min-release-age=0 <pkg>`.

## Changelog

Fleet changes are summarized in this repository's PRs and release notes. Do
not add a changelog or change fragment to a copied upstream directory.

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

## Documentation index

Read the relevant guide before working in that area:

- `docs/guides/web-interface.md` — web stack boundaries (`web/app`, `web/design`, `web/server`, `web/protocol`), runtime pin, install recovery. Read before any change under `web/`.
- `docs/guides/upstream-runtime.md` — pinned runtime upgrades, daemon protocol changes, adding LLM providers. Read before upgrading `PRIME_AGENT_RUNTIME.json` or touching daemon-facing `web/server` code.
- `docs/guides/github-workflow.md` — issue/PR etiquette and the PR handling flow. Read before creating issues/PRs or posting comments.
- `docs/guides/tmux-testing.md` — driving the Prime Agent TUI in tmux. Read before interactive-mode testing.
- `docs/guides/releasing.md` — Fleet release steps. Read before cutting a release.
