#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "ERROR: $1 is required for Prime Agent Codex setup." >&2
		exit 1
	fi
}

version_at_least() {
	node -e '
const [actual, required] = process.argv.slice(1).map((value) => value.split(".").map(Number));
const satisfies = actual[0] > required[0]
	|| (actual[0] === required[0] && actual[1] > required[1])
	|| (actual[0] === required[0] && actual[1] === required[1] && actual[2] >= required[2]);
process.exit(satisfies ? 0 : 1);
' "$1" "$2"
}

require_command node
require_command npm
require_command pnpm

node_version="$(node --version | sed 's/^v//')"
npm_version="$(npm --version)"
pnpm_version="$(pnpm --dir web --version)"

if ! version_at_least "$node_version" "22.8.0"; then
	echo "ERROR: Node.js 22.8.0 or newer is required; found $node_version." >&2
	exit 1
fi

if ! version_at_least "$npm_version" "11.10.0"; then
	echo "ERROR: npm 11.10 or newer is required; found $npm_version." >&2
	exit 1
fi

pnpm_major="${pnpm_version%%.*}"
if [[ "$pnpm_major" != "11" ]]; then
	echo "ERROR: pnpm 11 is required; found $pnpm_version." >&2
	exit 1
fi

echo "==> Prime Agent Codex bootstrap"
echo "repo: $repo_root"
echo "node: $node_version"
echo "npm: $npm_version"
echo "pnpm: $pnpm_version"

echo "==> Installing root npm dependencies"
npm ci --no-audit --no-fund

echo "==> Installing web workspace dependencies"
pnpm install --dir web --frozen-lockfile

echo "==> Bootstrap complete"
