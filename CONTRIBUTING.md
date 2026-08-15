# Contributing to Prime Agent

Thanks for contributing. This file covers the process; `AGENTS.md` contains the repository's technical rules (development commands, changelog format, dependency policy, daemon protocol). Read both before opening a pull request.

## Code of Conduct

All participants must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- Report a bug or request a feature with the issue templates
- Fix an existing issue or improve the documentation
- Ask questions on [GitHub Discussions](https://github.com/Qredence/fleet-prime-agent/discussions)

## Getting started

1. Fork the repository and clone your fork
2. Install dependencies: `npm ci`, then `pnpm install --dir web`
3. Create a branch and make your changes
4. Run `npm run check` (format, lint, type-check; does not run tests)
5. Run focused tests from the package root, e.g. `cd packages/coding-agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts`
6. Push the branch and open a pull request into `main`

## Pull requests

- One logical change per PR, containing only related files
- Maintainers review and merge; contributors do not merge their own PRs
- Complete the checklist in the pull request template

## Issues

- Use the bug report or feature request template
- Add `pkg:*` labels to show which package the issue affects: `pkg:agent`, `pkg:ai`, `pkg:coding-agent`, `pkg:tui`
- Bug reports need reproduction steps and environment details

## Changelog

Each package has its own `CHANGELOG.md`. Add one line per change under `## [Unreleased]`, starting with a past-tense verb (Added, Changed, Fixed, Removed). See `AGENTS.md` for the exact format.

## Documentation

- [Wiki](https://github.com/Qredence/fleet-prime-agent/wiki) — browsable documentation
- `packages/coding-agent/docs/development.md` — build and run from source
- `web/app/ARCHITECTURE.md` — web chat architecture

## Security

Report vulnerabilities privately per `SECURITY.md`. Do not open a public issue for a security problem.
