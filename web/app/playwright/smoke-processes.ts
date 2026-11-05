import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

/** Written into each run's state dir so a later run can tell it was abandoned. */
export const SMOKE_OWNER_PID_FILE = "owner.pid"

const FLEET_SMOKE_MARKER = "/fleet-smoke-"
const FLEET_SMOKE_ID_LEN = 6

export type ProcessInfo = { pid: number; ppid: number; pgid: number; command: string }

function isAsciiAlnum(char: string): boolean {
	if (char.length !== 1) return false
	const code = char.charCodeAt(0)
	return (
		(code >= 48 && code <= 57) || // 0-9
		(code >= 65 && code <= 90) || // A-Z
		(code >= 97 && code <= 122) // a-z
	)
}

function isAsciiWhitespace(char: string | undefined): boolean {
	return char === " " || char === "\t" || char === "\n" || char === "\r"
}

/**
 * Pull `<tmp>/fleet-smoke-XXXXXX` out of a process command line.
 * Same shape as the old `/(\/\S*?\/fleet-smoke-[A-Za-z0-9]{6})(?=[/\s]|$)/` match,
 * without a backtracking regex (Sonar).
 */
function extractSmokeStateDir(command: string): string | undefined {
	let searchFrom = 0
	while (searchFrom < command.length) {
		const markerAt = command.indexOf(FLEET_SMOKE_MARKER, searchFrom)
		if (markerAt < 0) return undefined

		const idStart = markerAt + FLEET_SMOKE_MARKER.length
		const idEnd = idStart + FLEET_SMOKE_ID_LEN
		if (idEnd > command.length) return undefined

		let idOk = true
		for (let i = idStart; i < idEnd; i++) {
			if (!isAsciiAlnum(command[i]!)) {
				idOk = false
				break
			}
		}
		if (!idOk) {
			searchFrom = markerAt + 1
			continue
		}

		const next = idEnd < command.length ? command[idEnd] : undefined
		if (next !== undefined && next !== "/" && !isAsciiWhitespace(next)) {
			searchFrom = markerAt + 1
			continue
		}

		let tokenStart = markerAt
		while (tokenStart > 0 && !isAsciiWhitespace(command[tokenStart - 1])) {
			tokenStart--
		}

		const firstSlash = command.indexOf("/", tokenStart)
		// Need a parent path segment: `/…/fleet-smoke-XXXXXX` (not bare `/fleet-smoke-XXXXXX`).
		if (firstSlash < 0 || firstSlash >= markerAt) {
			searchFrom = markerAt + 1
			continue
		}

		return command.slice(firstSlash, idEnd)
	}
	return undefined
}

/** Parse one `ps -axo pid=,ppid=,pgid=,command=` line without a backtracking regex. */
function parseProcessLine(line: string): ProcessInfo | undefined {
	let i = 0
	const len = line.length

	const skipSpaces = () => {
		while (i < len && (line[i] === " " || line[i] === "\t")) i++
	}
	const readNumber = (): number | undefined => {
		if (i >= len || line[i]! < "0" || line[i]! > "9") return undefined
		let value = 0
		while (i < len) {
			const char = line[i]!
			if (char < "0" || char > "9") break
			value = value * 10 + (char.charCodeAt(0) - 48)
			i++
		}
		return value
	}

	skipSpaces()
	const pid = readNumber()
	if (pid === undefined) return undefined
	skipSpaces()
	const ppid = readNumber()
	if (ppid === undefined) return undefined
	skipSpaces()
	const pgid = readNumber()
	if (pgid === undefined) return undefined
	// ps always separates command with whitespace; require it like the old regex `\s+(.*)`.
	if (i >= len || (line[i] !== " " && line[i] !== "\t")) return undefined
	skipSpaces()
	return { pid, ppid, pgid, command: line.slice(i) }
}

export function listProcesses(): ProcessInfo[] {
	if (process.platform === "win32") return []
	// Absolute path: avoids PATH lookup (Sonar typescript:S4036). macOS/Linux only; win32 no-ops above.
	const output = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,command="], {
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	})
	return output.split("\n").flatMap((line) => {
		const parsed = parseProcessLine(line)
		return parsed ? [parsed] : []
	})
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

function signal(target: number, name: NodeJS.Signals): void {
	try {
		process.kill(target, name)
	} catch {
		// Already gone.
	}
}

async function waitForExit(pids: number[], timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs
	while (pids.some(isAlive)) {
		if (Date.now() >= deadline) return false
		await delay(100)
	}
	return true
}

/** SIGTERM each process (and the group it leads), wait, then SIGKILL stragglers. */
export async function terminateProcesses(processes: ProcessInfo[], timeoutMs = 10_000): Promise<void> {
	if (processes.length === 0) return
	const signalAll = (name: NodeJS.Signals) => {
		for (const info of processes) {
			if (info.pgid === info.pid) signal(-info.pid, name)
			signal(info.pid, name)
		}
	}
	const pids = processes.map((info) => info.pid)
	signalAll("SIGTERM")
	if (await waitForExit(pids, timeoutMs)) return
	signalAll("SIGKILL")
	await waitForExit(pids, 2_000)
}

/** Processes whose command line runs from, or points into, `stateDir`. */
export function processesUnder(stateDir: string, processes = listProcesses()): ProcessInfo[] {
	const roots = new Set([stateDir])
	try {
		roots.add(realpathSync(stateDir))
	} catch {
		// The dir may already be gone; the original path is still on the command line.
	}
	return processes.filter((info) => [...roots].some((root) => info.command.includes(`${root}/`)))
}

/** Gone, or its recorded owner (a Playwright runner) has exited. */
function isAbandoned(stateDir: string): boolean {
	if (!existsSync(stateDir)) return true
	try {
		const owner = Number(readFileSync(join(stateDir, SMOKE_OWNER_PID_FILE), "utf8"))
		return Number.isInteger(owner) && owner > 0 && !isAlive(owner)
	} catch {
		// No owner file (older run, or a caller-provided dir): never guess.
		return false
	}
}

/**
 * Stop daemons left by earlier smoke runs whose teardown never ran (crash,
 * Ctrl-C) or predates this fix. Only abandoned state dirs are touched, so a
 * concurrent smoke run keeps its daemon.
 */
export async function reapAbandonedSmokeDaemons(currentStateDir?: string): Promise<void> {
	const byStateDir = new Map<string, ProcessInfo[]>()
	for (const info of listProcesses()) {
		const stateDir = extractSmokeStateDir(info.command)
		if (!stateDir || stateDir === currentStateDir) continue
		byStateDir.set(stateDir, [...(byStateDir.get(stateDir) ?? []), info])
	}
	for (const [stateDir, processes] of byStateDir) {
		if (!isAbandoned(stateDir)) continue
		await terminateProcesses(processes)
		if (process.env.FLEET_SMOKE_KEEP_STATE !== "1") rmSync(stateDir, { recursive: true, force: true })
	}
}
