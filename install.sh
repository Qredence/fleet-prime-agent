#!/bin/sh

set -eu

prime_agent_repository_url="${PRIME_AGENT_REPOSITORY_URL:-https://github.com/Qredence/fleet-prime-agent.git}"
prime_agent_repository_ref="${PRIME_AGENT_REPOSITORY_REF:-main}"
prime_agent_pnpm_version="${PRIME_AGENT_PNPM_VERSION:-11.15.1}"
prime_agent_checkout_dir=$(pwd)
prime_agent_pnpm_mode=

die() {
	printf 'error: %s\n' "$1" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Usage: install.sh

Install Qredence/fleet-prime-agent into the current directory, build the
production web runtime, and link the prime-agent command globally.

The current directory must be empty or an existing checkout of:
  https://github.com/Qredence/fleet-prime-agent.git

Environment overrides for testing or pinned source installs:
  PRIME_AGENT_REPOSITORY_URL   Repository URL (default: Qredence/fleet-prime-agent)
  PRIME_AGENT_REPOSITORY_REF   Branch or tag to clone (default: main)
  PRIME_AGENT_PNPM_VERSION     Ephemeral pnpm version (default: 11.15.1)
EOF
}

command_required() {
	command -v "$1" >/dev/null 2>&1 || die "$1 is required. Install it and run this installer again."
}

node_is_supported() {
	node -e '
const [major, minor, patch] = process.versions.node.split(".").map(Number);
const supported = major > 22 || (major === 22 && (minor > 8 || (minor === 8 && patch >= 0)));
process.exit(supported ? 0 : 1);
'
}

pnpm_is_supported() {
	version=$(pnpm --version 2>/dev/null || true)
	major=$(printf '%s' "$version" | awk -F. 'NR == 1 { gsub(/[^0-9].*/, "", $1); print $1 }')
	case "$major" in
		''|*[!0-9]*) return 1 ;;
		*) [ "$major" -eq 11 ] ;;
	esac
}

normalize_repository_url() {
	printf '%s' "$1" | sed 's#/$##; s#\.git$##'
}

checkout_matches_repository() {
	[ -e .git ] || [ -L .git ] || return 1

	origin=$(git config --get remote.origin.url 2>/dev/null || true)
	if [ -n "$origin" ] && [ "$(normalize_repository_url "$origin")" = "$(normalize_repository_url "$prime_agent_repository_url")" ]; then
		return 0
	fi

	case "$origin" in
		https://github.com/Qredence/fleet-prime-agent|https://github.com/Qredence/fleet-prime-agent.git|git@github.com:Qredence/fleet-prime-agent|git@github.com:Qredence/fleet-prime-agent.git)
			return 0
			;;
	esac
	return 1
}

checkout_is_empty() {
	for entry in ./* ./.??*; do
		if [ -e "$entry" ] || [ -L "$entry" ]; then
			return 1
		fi
	done
	return 0
}

prepare_checkout() {
	if checkout_matches_repository; then
		printf 'Using existing Qredence/fleet-prime-agent checkout: %s\n' "$prime_agent_checkout_dir"
		return
	fi

	if ! checkout_is_empty; then
		die "the current directory is not an empty Qredence/fleet-prime-agent checkout; refusing to overwrite it"
	fi

	printf 'Cloning %s (%s) into %s\n' "$prime_agent_repository_url" "$prime_agent_repository_ref" "$prime_agent_checkout_dir"
	git clone --branch "$prime_agent_repository_ref" --single-branch "$prime_agent_repository_url" .
}

select_pnpm() {
	if command -v pnpm >/dev/null 2>&1 && pnpm_is_supported; then
		prime_agent_pnpm_mode=system
		printf 'Using pnpm %s\n' "$(pnpm --version)"
		return
	fi

	prime_agent_pnpm_mode=ephemeral
	printf 'Using pnpm %s through npm exec\n' "$prime_agent_pnpm_version"
}

run_pnpm() {
	if [ "$prime_agent_pnpm_mode" = system ]; then
		pnpm "$@"
	else
		npm exec --yes --package="pnpm@$prime_agent_pnpm_version" -- pnpm "$@"
	fi
}

build_checkout() {
	printf '\nInstalling root npm dependencies...\n'
	npm ci --no-audit --no-fund

	printf '\nInstalling web workspace dependencies...\n'
	run_pnpm install --dir web --frozen-lockfile

	printf '\nBuilding Fleet Prime packages...\n'
	npm run build

	printf '\nBuilding the production web runtime...\n'
	run_pnpm --dir web --filter @prime-agent/web build
	node scripts/build-web-release.mjs
}

link_cli() {
	printf '\nLinking the prime-agent and fleet-prime commands globally...\n'
	npm link --force .
	hash -r 2>/dev/null || true

	if command -v prime-agent >/dev/null 2>&1; then
		printf '\nFleet Prime is ready.\n'
		printf '  Checkout: %s\n' "$prime_agent_checkout_dir"
		printf '  Command:  %s\n' "$(command -v prime-agent)"
		printf '\nRun from a project directory:\n  fleet-prime\n'
		return
	fi

	global_prefix=$(npm prefix -g 2>/dev/null || true)
	if [ -n "$global_prefix" ]; then
		printf '\nFleet Prime was linked, but %s/bin is not on PATH.\n' "$global_prefix" >&2
		printf 'Add %s/bin to your shell PATH, then run: fleet-prime\n' "$global_prefix" >&2
	else
		printf '\nFleet Prime was linked, but the global npm bin directory is not on PATH.\n' >&2
		printf "Add npm's global bin directory to PATH, then run: fleet-prime\n" >&2
	fi
}

main() {
	case "${1:-}" in
		-h|--help)
			usage
			return 0
			;;
		"")
			;;
		*)
			die "unknown argument: $1 (this installer does not accept positional arguments)"
			;;
	esac

	command_required git
	command_required node
	command_required npm

	if ! node_is_supported; then
		die "Node.js 22.8.0 or newer is required; found $(node --version)"
	fi

	prepare_checkout
	select_pnpm
	build_checkout
	link_cli
}

main "$@"
