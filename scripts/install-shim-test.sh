#!/bin/sh
# install-shim-test.sh — smoke test for the fleet-prime shim installer.
# Asserts: (1) the existing prime-agent is preserved on PATH, (2) the
# shim file is written under $HOME/.local/bin, (3) the shim exec line
# points at the checkout's fleet-prime.sh.
set -e

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/fp-shim.XXXXXX")
trap 'rm -rf "$SANDBOX"' EXIT INT TERM
export HOME="$SANDBOX/home"
mkdir -p "$HOME/.local" "$SANDBOX/bin"

# Plant a fake prime-agent that must survive the install untouched.
FAKE="$SANDBOX/bin/prime-agent"
printf '#!/bin/sh\necho fake prime-agent\n' > "$FAKE"
chmod +x "$FAKE"

# Run the shim function in a subshell where $SANDBOX/bin is the only
# path that contains prime-agent. The real system PATH (which may have
# a stale fleet-prime from a previous install) is kept so the installer
# sees a realistic environment, but the fake prime-agent is found first.
export PATH="$SANDBOX/bin:$PATH"
prime_agent_checkout_dir=$(pwd)
[ "$prime_agent_checkout_dir" = "$REPO_ROOT" ] || { echo "run from repo root" >&2; exit 1; }
sed -n '/^install_fleet_prime_shim() {/,/^}$/p' "$REPO_ROOT/install.sh" > "$SANDBOX/func.sh"
(	die() { printf 'error: %s\n' "$1" >&2; exit 1; }
	. "$SANDBOX/func.sh"
	install_fleet_prime_shim )

# (1) Fake prime-agent must still be the one on PATH.
after=$(command -v prime-agent || true)
[ "$after" = "$FAKE" ] || { echo "FAIL: prime-agent clobbered ($after)" >&2; exit 1; }

# (2) Shim file must exist at the expected location and be executable.
shim="$HOME/.local/bin/fleet-prime"
[ -x "$shim" ] || { echo "FAIL: shim not installed at $shim" >&2; exit 1; }

# (3) Shim exec line must point at the checkout's fleet-prime.sh.
exec_line=$(grep -E '^exec ' "$shim" || true)
case "$exec_line" in
	*"$REPO_ROOT/fleet-prime.sh"*) ;;
	*) echo "FAIL: shim does not point at checkout: $exec_line" >&2; exit 1 ;;
esac

echo "OK: prime-agent preserved at $after"
echo "OK: fleet-prime shim installed at $shim"
echo "OK: shim forwards to $REPO_ROOT/fleet-prime.sh"
exit 0
