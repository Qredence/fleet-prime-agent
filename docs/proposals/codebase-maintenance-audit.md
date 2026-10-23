# Codebase maintenance audit

This audit recorded four small, independent follow-up tasks. All four items have
been resolved:

1. **Sandbox-provider toast casing (`web/app/src/components/settings/sandbox-provider-section.tsx`):**
   Updated to sentence case (`Sandbox provider updated`).
2. **POSIX `sh` fallback in `install.sh` (`install_fleet_agent_shim`):**
   Replaced Bash-only `$EUID` with a portable `$(id -u)` lookup so unwritable
   `$HOME` fallbacks succeed under `/bin/sh` (`dash`) with `set -u`.
3. **Contributor vs. product installation copy (`README.md`):**
   Clarified that `npm install --global @qredence/fleet` is the product install
   path while `./install.sh` is for contributors (using system pnpm 11 when
   available and `npm exec` as the ephemeral fallback).
4. **Unwritable-`HOME` shim test coverage (`scripts/install-shim-test.sh`):**
   Extended to run `install_fleet_agent_shim` under `/bin/sh -eu` with an
   unusable `HOME` and verify creation of the `TMPDIR` fallback shim.
