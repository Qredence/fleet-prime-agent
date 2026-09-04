# Contributing to Fleet Prime Agent

This document covers contributor process. `AGENTS.md` is the repository-wide engineering and agent execution contract; do not duplicate it here.

## Ways to contribute

- Report bugs or request features with the issue templates.
- Fix an existing issue or improve documentation.
- Ask questions on [GitHub Discussions](https://github.com/Qredence/fleet-prime-agent/discussions).

All participants must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

1. Fork and clone the repository.
2. Install the workspace with `pnpm install` from the repository root.
3. Create a focused branch and make the change.
4. Run `pnpm run check`.
5. Run focused behavioral tests from the owning workspace when behavior changed. For example:

   ~~~bash
   pnpm --filter @prime-agent/web-server exec vitest run src/__tests__/prime-bridge.test.ts
   ~~~

6. Run `pnpm run format` only when you intentionally want Biome to write formatting changes.

Never use `npm install` or `npm ci` at the repository root, and do not add a root `package-lock.json`.

## Changesets

User-visible changes to the published `@qredence/fleet` package require a Changeset. Documentation-only, CI-only, and internal changes that do not affect the released package do not need one; state the no-release reason in the pull request.

Create a Changeset with:

~~~bash
pnpm changeset
~~~

The release automation turns accumulated Changesets into a release pull request. Prime Agent engine release notes belong upstream.

## Pull requests

- Keep one logical change per pull request and include only related files.
- Describe the behavior or process change, affected packages, and validation performed.
- Complete the pull request template.
- Maintainers review and merge; contributors do not merge their own pull requests.

## Issues and security

Use the issue template that matches the problem and include reproduction steps, expected behavior, actual behavior, and relevant environment details.

Report vulnerabilities privately according to `SECURITY.md`; do not open a public issue for a security problem.

## Documentation map

- [ARCHITECTURE.md](ARCHITECTURE.md) — system ownership, boundaries, and data flow.
- [Adapter contract](docs/reference/adapter-contract.md) — browser/server compatibility and privacy guarantees.
- [Upstream runtime guide](docs/guides/upstream-runtime.md) — runtime pin upgrades and daemon compatibility.
- [Release guide](docs/guides/releasing.md) — release automation and artifact publication.
- [Manual tmux testing](docs/guides/tmux-testing.md) — interactive terminal testing.
- [React Doctor](docs/guides/react-doctor.md) — optional React audit.
- [Support](SUPPORT.md) — support and community channels.
