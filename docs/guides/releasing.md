# Releasing Guide

Read this before cutting a Fleet release.

The upstream engine version is pinned in
`PRIME_AGENT_RUNTIME.json`; upgrades are explicit dependency updates with
checksum and adapter verification.

Fleet release (web product + packed CLI artifact + npm publish):

1. Upgrade the runtime pin if needed, then run `pnpm install` and `pnpm run check`.
2. Build and pack: `pnpm run build:web:release && pnpm run release:pack`.
3. Tag this repository; the CircleCI release pipeline builds, smoke-tests, and
   publishes `@qredence/fleet`. Do not publish Prime Agent itself from Fleet.

## npm publishing

Pushing a `v*` tag publishes `@qredence/fleet` to npmjs.com from the
CircleCI `release` workflow using npm trusted publishing (OIDC, no stored
tokens). The publish runs from `packages/fleet-prime` after the packed
tarball passes the web release smoke test. The upstream Prime Agent engine is
never republished by Fleet; the published package installs it as the
checksum-pinned tarball dependency from `PRIME_AGENT_RUNTIME.json`.

Trusted publishing from CircleCI exchanges a job-scoped OIDC token for a
short-lived publish token (`NPM_ID_TOKEN`); no `NPM_TOKEN` is stored anywhere.
It requires an npm CLI of at least 11.5.1 on Node.js 22.14 or later (the
`release` job upgrades npm itself) and the trusted publisher configured on
npmjs.com as described below. Provenance attestations are not supported for
CircleCI trusted publishing; releases publish without them.

### Required CircleCI setup

The `release` job (`.circleci/config.yml`) needs two one-time setups:

1. **GitHub release context.** Create a CircleCI context named `github-release`
   containing a `GITHUB_TOKEN` environment variable: a fine-grained GitHub PAT
   with Contents read/write on `Qredence/fleet-prime-agent` only (the job
   creates the GitHub release and uploads the tarball plus SHA256SUMS with
   it). The `release` job attaches this context.
2. **npm trusted publisher.** On
   `https://www.npmjs.com/package/@qredence/fleet/access` under Trusted
   Publishing, add a **CircleCI** publisher with the organization ID and
   project ID from `.circleci/info.yml`, the pipeline definition ID from
   CircleCI Project Settings → Project Setup, and the VCS origin
   `github.com/Qredence/fleet-prime-agent`; allow the `npm publish` action.
   Optionally record the `github-release` context ID to also bind publishing
   to that context.

### One-time bootstrap (done)

The first version of a new package cannot be published via trusted
publishing: npm's trusted-publisher settings require the package to already
exist. `@qredence/fleet@0.1.0` was therefore published manually once with 2FA
(`pnpm run build:web:release && npm publish ./packages/fleet-prime --access
public` after `npm login`); later tagged releases publish from CircleCI with
no stored tokens.

### Hardening (recommended)

After the trusted publisher works, restrict the package on npmjs.com
(Settings → Publishing access → "Require two-factor authentication and
disallow tokens") so only the trusted publisher can publish. As defense in
depth, the CircleCI guide also suggests context expression restrictions such
as `not job.ssh.enabled` (npm rejects OIDC tokens from SSH reruns).
