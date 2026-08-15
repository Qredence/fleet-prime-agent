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

# Source-checkout launcher for the Qredence web interface. Runs the Vite dev
# server (same as `npm run dev:web`) from web/app, serving on 127.0.0.1:3000
# by default. Supports --host and --port overrides, e.g.
# `./fleet-prime.sh --port 3001` or `./fleet-prime.sh --host 0.0.0.0`.
HOST="127.0.0.1"
PORT=3000
while [[ $# -gt 0 ]]; do
	case "$1" in
		--host=*) HOST="${1#--host=}" ;;
		--host) HOST="$2"; shift ;;
		--port=*) PORT="${1#--port=}" ;;
		--port) PORT="$2"; shift ;;
		--help)
			echo "Usage: fleet-prime [--host <host>] [--port <port>]"
			exit 0
			;;
		*) echo "Unknown option: $1" >&2; exit 1 ;;
	esac
	shift
done

cd "$SCRIPT_DIR/web/app"
exec ../node_modules/.bin/vite dev --host "$HOST" --port "$PORT"
