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
2. Install dependencies: `npm ci`, then `pnpm install --dir web`
3. Create a branch and make your changes
4. Run `npm run check` (format, lint, type-check; does not run tests)
5. Run focused web tests from the relevant package root, e.g. `cd web/server && pnpm exec vitest run src/__tests__/prime-bridge.test.ts`
6. Push the branch and open a pull request into `main`

Use the direct npm and pnpm commands above for local development. Always run
pnpm with `--dir web`; running it at the repository root rewrites the root
dependency layout and is unsupported.

## Pull requests

- One logical change per PR, containing only related files
- Maintainers review and merge; contributors do not merge their own PRs
- Complete the checklist in the pull request template

## Issues

- Use the bug report or feature request template
- Add the existing package labels that best describe the affected Fleet surface
- Bug reports need reproduction steps and environment details

## Changelog

Summarize Fleet changes in the pull request and release notes. Prime Agent
release notes are maintained upstream.

## Documentation

- [Wiki](https://github.com/Qredence/fleet-prime-agent/wiki) — browsable documentation
- `web/app/ARCHITECTURE.md` — web chat architecture

## Security

Report vulnerabilities privately per `SECURITY.md`. Do not open a public issue for a security problem.
