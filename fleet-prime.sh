#!/usr/bin/env bash
set -euo pipefail

# Resolve the real script path so the launcher also works when invoked through
# a symlink (e.g. ~/.pi/agent/bin/fleet-prime).
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
	DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
	SOURCE="$(readlink "$SOURCE")"
	[[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"

# `fleet-prime install` runs the source installer (deps, build, launcher shim).
if [[ "${1:-}" == "install" ]]; then
	shift
	exec "$SCRIPT_DIR/install.sh" "$@"
fi

# The wrapper resolves the pinned stock Prime Agent release from node_modules
# and starts the production Fleet web bundle.
exec node "$SCRIPT_DIR/packages/fleet-web/bin/fleet-prime.mjs" "$@"
