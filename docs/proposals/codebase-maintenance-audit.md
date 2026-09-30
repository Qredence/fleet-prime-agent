# Codebase maintenance audit

This audit proposes four small, independent follow-up tasks. Each task should be
implemented and reviewed separately so that its intent and validation remain
clear.

## Product priority

Fleet users should install the published package with
`npm install --global @qredence/fleet`; the source installer is contributor
tooling, not an alternative product installation flow. Of the findings below,
the UI typo is product-facing. The source-installer bug, documentation
discrepancy, and test gap are lower-priority repository-maintenance work and
should not distract from validation of the packed npm artifact and its
`fleet-agent` launcher.

## 1. Typo: normalize the sandbox-provider success message

**Problem:** The success toast says `Sandbox Provider updated successfully`,
capitalizing the common noun “provider” in the middle of a sentence. The error
message immediately below it uses sentence case.

**Proposed task:** Change the toast to `Sandbox provider updated successfully`
and add an assertion for the success copy to the sandbox-provider component
tests.

**Location:** `web/app/src/components/settings/sandbox-provider-section.tsx`.

## 2. Bug: make the source-installer fallback portable under POSIX `sh`

**Problem:** `install.sh` runs with `set -u` and uses `$EUID` when `HOME` is not
writable. `EUID` is a Bash variable and is not guaranteed to exist in the
POSIX shells that execute this script. On systems such as Debian or Ubuntu,
where `/bin/sh` is commonly `dash`, the intended temporary-directory fallback
can instead terminate with an unset-variable error.

**Proposed task:** Derive the numeric user ID portably (for example, once via
`id -u`) and use that value in both temporary shim paths. Preserve the override,
`HOME`, and `TMPDIR` precedence already implemented by the installer.

**Location:** `install.sh`, in `install_fleet_agent_shim`.

## 3. Documentation discrepancy: distinguish product and contributor installation

**Problem:** Presenting “Install from source” as a peer of the quick start can
make the checkout installer look like an alternative product installation
path, even though the published `@qredence/fleet` package is the supported path
for users. Within the contributor path, the installer first uses a compatible
system pnpm and invokes `npm exec` only as a fallback.

**Proposed task:** Label source installation as contributor/development setup,
direct users to `npm install --global @qredence/fleet`, and then describe pnpm
11 with npm as the ephemeral-pnpm fallback for contributors. Keep the wording
aligned with `select_pnpm` rather than duplicating more implementation detail.

**Locations:** `README.md` and `install.sh` (`select_pnpm`).

## 4. Test improvement: exercise the installer's unwritable-`HOME` fallback

**Problem:** The installer smoke test covers only a writable
`$HOME/.local/bin`. It does not enter either temporary-directory branch, so it
cannot detect the non-portable `$EUID` bug or regressions in the documented
fallback behavior.

**Proposed task:** Extend `scripts/install-shim-test.sh` with an isolated case
that runs the extracted function under `/bin/sh`, supplies an unwritable (or
otherwise unusable) `HOME`, supplies a writable `TMPDIR`, and asserts that the
shim is created below `TMPDIR` without replacing the existing `prime-agent`.
Also cover the final `/tmp` branch where the test environment permits it.

**Location:** `scripts/install-shim-test.sh`.
