# Releasing Guide

Read this before cutting a Fleet release.

The upstream engine version is pinned in
`PRIME_AGENT_RUNTIME.json`; upgrades are explicit dependency updates with
checksum and adapter verification.

Fleet release (web product + packed CLI artifact + npm publish):

1. Upgrade the runtime pin if needed, then run `pnpm install` and `pnpm run check`.
2. Build and pack: `pnpm run build:web:release && pnpm run release:pack`.
3. Tag this repository; the release workflow builds, smoke-tests, and publishes
   `@qredence/fleet`. Do not publish Prime Agent itself from Fleet.

## npm publishing

Pushing a `v*` tag (or dispatching the release workflow) publishes
`@qredence/fleet` to npmjs.com from the release workflow using
npm trusted publishing (OIDC, no stored tokens). The publish runs from
`packages/fleet-prime` after the packed tarball passes the web release smoke
test. The upstream Prime Agent engine is never republished by Fleet; the
published package installs it as the checksum-pinned tarball dependency from
`PRIME_AGENT_RUNTIME.json`.

Trusted publishing requires `id-token: write` on a GitHub-hosted runner, an
npm CLI of at least 11.5.1 (the workflow upgrades npm itself), and a
`repository.url` in `packages/fleet-prime/package.json` that matches this
GitHub repository exactly.

### One-time bootstrap

The first version of a new package cannot be published via trusted
publishing: npm's trusted-publisher settings require the package to already
exist.

1. Ensure the `@qredence` organization exists on npmjs.com and your account is
   an owner, then sign in on this machine with `npm login` (npm reports
   missing publish permission as `E404`).
2. Build locally and publish the initial version once with 2FA:

   ```bash
   pnpm run build:web:release
   npm publish ./packages/fleet-prime --access public
   ```

3. Configure the trusted publisher at
   `https://www.npmjs.com/package/@qredence/fleet/access`:
   GitHub Actions, organization `Qredence`, repository `fleet-prime-agent`,
   workflow filename `release-fleet.yml`, allowed action `npm publish`.
4. Later tagged releases publish through OIDC with no stored tokens.

### Hardening (recommended)

After the trusted publisher works, restrict the package on npmjs.com
(Settings → Publishing access → "Require two-factor authentication and
disallow tokens") so only the trusted publisher can publish.
