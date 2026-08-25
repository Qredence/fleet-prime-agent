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

install_fleet_prime_shim() {
	printf '\nInstalling the fleet-prime launcher shim...\n'

	existing_prime_agent=$(command -v prime-agent 2>/dev/null || true)
	if [ -n "$existing_prime_agent" ]; then
		printf 'Detected existing prime-agent at %s \xe2\x80\x94 leaving it untouched.\n' "$existing_prime_agent"
	fi

	# Pick an install location. Prefer $HOME/.local/bin (XDG-friendly, writable
	# without sudo on every mainstream Unix); fall back to a per-user tmpdir
	# if $HOME is not writable so the installer never dies here.
	shim_dir=
	if [ -n "${HOME:-}" ] && [ -d "$HOME" ] && [ -w "$HOME" ]; then
		shim_dir="$HOME/.local/bin"
	elif [ -n "${TMPDIR:-}" ] && [ -d "$TMPDIR" ] && [ -w "$TMPDIR" ]; then
		shim_dir="$TMPDIR/fleet-prime-shim-$EUID-$$"
	else
		shim_dir="/tmp/fleet-prime-shim-$EUID-$$"
	fi

	if ! mkdir -p "$shim_dir" 2>/dev/null; then
		die "could not create shim directory: $shim_dir"
	fi

	shim_path="$shim_dir/fleet-prime"
	installed_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf '%s' "$(date -u)")

	# Write the shim. The launcher script in the checkout already handles
	# `fleet-prime install`, the dev server fallback, and symlink resolution,
	# so the shim is just a tiny exec wrapper. The here-doc keeps the literal
	# "$@" in the output so all arguments are forwarded.
	{
		cat <<SHIM_EOF
#!/bin/sh
# Fleet Prime launcher installed by fleet-prime-agent on $installed_at
# Source checkout: $prime_agent_checkout_dir
exec "$prime_agent_checkout_dir/fleet-prime.sh" "\$@"
SHIM_EOF
	} > "$shim_path" || die "could not write shim: $shim_path"

	chmod +x "$shim_path" || die "could not chmod +x $shim_path"

	if command -v fleet-prime >/dev/null 2>&1; then
		resolved=$(command -v fleet-prime)
		# Only celebrate when the freshly-installed shim is the one on PATH.
		# A stale fleet-prime from a previous run elsewhere is not a success
		# for THIS install.
		if [ "$resolved" = "$shim_path" ]; then
			printf '\nFleet Prime is ready.\n'
			printf '  Checkout: %s\n' "$prime_agent_checkout_dir"
			printf '  Command:  %s\n' "$resolved"
			printf '\nRun from a project directory:\n  fleet-prime\n'
			return
		fi
	fi

	printf '\nFleet Prime shim was installed at %s\n' "$shim_path" >&2
	printf 'Add %s to your shell PATH, then run: fleet-prime\n' "$shim_dir" >&2
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
	install_fleet_prime_shim
}

main "$@"
