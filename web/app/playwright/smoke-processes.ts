import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

/** Written into each run's state dir so a later run can tell it was abandoned. */
export const SMOKE_OWNER_PID_FILE = "owner.pid"

// A smoke state dir is `<tmp>/fleet-smoke-XXXXXX` (mkdtemp). The daemon, its
// workers and the kernel venv all run from, or point their socket into, it.
const SMOKE_STATE_DIR_IN_COMMAND = /(\/\S*?\/fleet-smoke-[A-Za-z0-9]{6})(?=[/\s]|$)/

export type ProcessInfo = { pid: number; ppid: number; pgid: number; command: string }

export function listProcesses(): ProcessInfo[] {
	if (process.platform === "win32") return []
	const output = execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], {
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	})
	return output.split("\n").flatMap((line) => {
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)
		if (!match) return []
		return [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4] }]
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
		const stateDir = SMOKE_STATE_DIR_IN_COMMAND.exec(info.command)?.[1]
		if (!stateDir || stateDir === currentStateDir) continue
		byStateDir.set(stateDir, [...(byStateDir.get(stateDir) ?? []), info])
	}
	for (const [stateDir, processes] of byStateDir) {
		if (!isAbandoned(stateDir)) continue
		await terminateProcesses(processes)
		if (process.env.FLEET_SMOKE_KEEP_STATE !== "1") rmSync(stateDir, { recursive: true, force: true })
	}
}
