# Contributing to Fleet Prime Agent

Thanks for contributing. This file covers the process; `AGENTS.md` contains the repository's technical rules (development commands, changelog format, dependency policy, daemon protocol). Read both before opening a pull request.

## Code of Conduct

All participants must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- Report a bug or request a feature with the issue templates
- Fix an existing issue or improve the documentation
- Ask questions on [GitHub Discussions](https://github.com/Qredence/fleet-prime-agent/discussions)

## Getting started

1. Fork the repository and clone your fork
2. Install dependencies: `pnpm install`
3. Create a branch and make your changes
4. Run `pnpm run check` (read-only formatting check, lint, and type-check; it does not run tests)
5. Run focused web tests from the relevant package root, e.g. `cd web/server && pnpm exec vitest run src/__tests__/prime-bridge.test.ts`
6. Run `pnpm run format` only when you intentionally want Biome to write formatting changes
7. Run `pnpm changeset` and commit the generated file for every user-visible `@qredence/fleet` change, unless the change is documentation-only, CI-only, or internal
8. Push the branch and open a pull request into `main`

Use the pnpm commands above for local development. Never run `npm install` at
the repository root; it drops a `package-lock.json` and rewrites the dependency
layout.

## Pull requests

- One logical change per PR, containing only related files
- Maintainers review and merge; contributors do not merge their own PRs
- Complete the checklist in the pull request template

## Issues

- Use the bug report or feature request template
- Add the existing package labels that best describe the affected Fleet surface
- Bug reports need reproduction steps and environment details

## Changelog

Run `pnpm changeset` for user-visible package changes. It creates a Markdown
file under `.changeset/` with the package and semver bump selected in the CLI:

```md
---
"@qredence/fleet": patch
---

Describe the user-visible change.
```

Documentation-only, CI-only, and internal changes do not need a Changeset;
state that explicitly in the pull request. The release-preparation job turns
accumulated Changesets into one release pull request and CircleCI publishes
after that pull request merges. Prime Agent engine release notes are
maintained upstream.

## Documentation

- [Wiki](https://github.com/Qredence/fleet-prime-agent/wiki) — browsable documentation
- `web/app/ARCHITECTURE.md` — web chat architecture

## Security

Report vulnerabilities privately per `SECURITY.md`. Do not open a public issue for a security problem.
