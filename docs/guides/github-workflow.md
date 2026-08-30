# GitHub Workflow Guide

Read this before creating issues or PRs, or posting comments.

## Creating issues

- Add the existing labels that best describe the affected Fleet surface.
- If an issue spans multiple surfaces, add all relevant labels.

## Posting issue/PR comments

- Write the full comment to a temp file and use `gh issue comment --body-file` or `gh pr comment --body-file`
- Never pass multi-line markdown directly via `--body` in shell commands
- Preview the exact comment text before posting
- Post exactly one final comment unless the user explicitly asks for multiple comments
- If a comment is malformed, delete it immediately, then post one corrected comment
- Keep comments concise, technical, and in the user's tone

## Closing issues via commit

- Include `fixes #<number>` or `closes #<number>` in the commit message
- This automatically closes the issue when the commit is merged

## PR workflow

- Analyze PRs without pulling locally first
- If the user approves: create a feature branch, pull PR, rebase on main, apply adjustments, commit, merge into main, push, close PR, and leave a comment in the user's tone
- We work in feature branches until everything is according to the user's requirements. Never merge PRs by yourself.
