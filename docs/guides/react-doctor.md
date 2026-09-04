# React Doctor

React Doctor is an optional audit for the React-heavy web workspaces. It is not part of the normal repository check.

## Run

From the repository root:

~~~bash
npx -y react-doctor@0.9.11 web --json
~~~

For a change-focused scan:

~~~bash
target_branch="${GITHUB_BASE_REF:-main}"
base_commit="$(git merge-base HEAD "origin/$target_branch")"
npx -y react-doctor@0.9.11 web --scope files --base "$base_commit" --include-untracked --json
~~~

Set `target_branch` to the pull request target branch when it is not available through `GITHUB_BASE_REF`.

The maintained scan scope is `web/`; packaged launcher code is not part of this audit. The repository configuration is `web/doctor.config.jsonc`.

## Interpretation

Treat new actionable findings in changed code as defects to fix or investigate. Prefer a code fix over a waiver.

Use a waiver only when the pattern is intentional, the rule cannot understand a repository or library contract, and the waiver is narrow enough to name the affected file and rule. Keep the rationale in `web/doctor.config.jsonc`; do not preserve scan output or one-off audit receipts in documentation.

When changing the scanner version, scan scope, or waiver baseline, update the command and configuration together and run the relevant web checks.
