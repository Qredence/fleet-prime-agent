# Releasing Guide

Read this before cutting a Fleet release.

The upstream engine version is pinned in `PRIME_AGENT_RUNTIME.json`; upgrades
are explicit dependency updates with checksum and adapter verification.

Fleet release (web product + packed CLI artifact):

1. Upgrade the runtime pin if needed, then run `pnpm install` and `pnpm run check`.
2. Build and pack: `pnpm run build:web:release && pnpm run release:pack`.
3. Tag this repository; do not publish Prime Agent itself from Fleet.
