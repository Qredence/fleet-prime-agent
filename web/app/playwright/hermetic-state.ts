import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Hermetic Prime state for the Playwright dev server.
 *
 * Without this, the dev server's daemon reads the developer's real
 * `~/.prime/agent` (sessions, projects, settings) and attaches to whatever
 * daemon already owns the default socket, so smoke results depend on local
 * history. Each run instead gets a fresh HOME, agent dir, and TMPDIR (which
 * hosts the default daemon socket directory).
 */
export const SMOKE_STATE_DIR_ENV = "FLEET_SMOKE_STATE_DIR"
/** Set when this run created the state dir, so teardown may delete it. */
export const SMOKE_STATE_OWNED_ENV = "FLEET_SMOKE_STATE_OWNED"

// macOS caps AF_UNIX paths at 104 bytes (Linux 108) including the NUL. The
// daemon creates `$TMPDIR/prime-agent-<uid>/daemon.sock` plus longer
// per-worker sockets (`worker-<12 hex>-<12 hex>.sock`) in the same directory.
const MAX_SOCKET_PATH_BYTES = 103
const WORST_CASE_SOCKET_NAME = `worker-${"0".repeat(12)}-${"0".repeat(12)}.sock`

function socketDirectory(stateDir: string): string {
	const uid = typeof process.getuid === "function" ? String(process.getuid()) : "user"
	return join(stateDir, `prime-agent-${uid}`)
}

function fitsSocketLimit(stateDir: string): boolean {
	if (process.platform === "win32") return true
	return Buffer.byteLength(join(socketDirectory(stateDir), WORST_CASE_SOCKET_NAME)) <= MAX_SOCKET_PATH_BYTES
}

/**
 * Create (once per Playwright run) the per-run state directory, or reuse
 * `FLEET_SMOKE_STATE_DIR` when set. The path is exported through the
 * environment so worker processes and global teardown reuse it.
 */
export function resolveSmokeStateDir(): string {
	const existing = process.env[SMOKE_STATE_DIR_ENV]
	if (existing) return existing
	let stateDir = mkdtempSync(join(tmpdir(), "fleet-smoke-"))
	if (!fitsSocketLimit(stateDir)) {
		// A long OS tmpdir (the macOS default /var/folders/... is ~49 bytes)
		// would push worker sockets past the limit; /tmp is short everywhere.
		rmSync(stateDir, { recursive: true, force: true })
		stateDir = mkdtempSync(join("/tmp", "fleet-smoke-"))
	}
	process.env[SMOKE_STATE_DIR_ENV] = stateDir
	process.env[SMOKE_STATE_OWNED_ENV] = "1"
	return stateDir
}

/** Environment for the dev server (and the daemon it spawns). */
export function hermeticServerEnv(stateDir: string): Record<string, string> {
	const home = join(stateDir, "home")
	mkdirSync(home, { recursive: true })
	return {
		HOME: home,
		TMPDIR: stateDir,
		PRIME_AGENT_CODING_AGENT_DIR: join(home, ".prime", "agent"),
		PI_CODING_AGENT_DIR: "",
		PRIME_AGENT_SESSION_DIR: "",
		PRIME_AGENT_CODING_AGENT_SESSION_DIR: "",
		PRIME_AGENT_INTERNAL_DAEMON_SUPERVISOR_REGISTRY_DIR: join(home, ".prime", "supervisor-owners"),
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_DATA_HOME: join(home, ".local", "share"),
		XDG_STATE_HOME: join(home, ".local", "state"),
	}
}
