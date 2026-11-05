import { rmSync } from "node:fs"
import { SMOKE_STATE_DIR_ENV, SMOKE_STATE_OWNED_ENV } from "./hermetic-state"
import { listProcesses, processesUnder, terminateProcesses } from "./smoke-processes"

/**
 * The dev server spawns the pinned Prime daemon detached, so it outlives the
 * webServer process. Stop this run's daemon and drop its state.
 *
 * Playwright stops `config.webServer` only after global teardown, and while it
 * runs the dev server respawns a lost daemon (FleetDaemonAgentConnection
 * recovery via ensureFleetDaemonRunning). So stop the dev server (a process
 * group leader spawned by this runner) first, then every process running from
 * the state dir: the daemon, its workers and their kernels.
 */
export default async function globalTeardown() {
	const stateDir = process.env[SMOKE_STATE_DIR_ENV]
	if (!stateDir) return
	const devServer = listProcesses().filter((info) => info.ppid === process.pid && info.command.includes("vite dev"))
	await terminateProcesses(devServer)
	await terminateProcesses(processesUnder(stateDir))
	if (process.env[SMOKE_STATE_OWNED_ENV] === "1" && process.env.FLEET_SMOKE_KEEP_STATE !== "1") {
		rmSync(stateDir, { recursive: true, force: true })
	}
}
