# Releasing Guide

Read this before cutting a Fleet release.

The upstream engine version is pinned in `PRIME_AGENT_RUNTIME.json`; upgrades
are explicit dependency updates with checksum and adapter verification.

Fleet release (web product + packed CLI artifact):

1. Upgrade the runtime pin if needed, then run `npm install`, `pnpm --dir web install`, and `npm run check`.
2. Build and pack: `npm run build && npm run build:web:release && npm run release:pack`.
3. Tag this repository; do not publish Prime Agent itself from Fleet.
