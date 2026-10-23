import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { resolve } from "node:path"
import { hermeticServerEnv, SMOKE_STATE_DIR_ENV, SMOKE_STATE_OWNED_ENV } from "./hermetic-state"

/**
 * The dev server spawns the pinned Prime daemon detached, so it outlives the
 * webServer process. Shut down the per-run daemon and drop its state.
 */
export default function globalTeardown() {
	const stateDir = process.env[SMOKE_STATE_DIR_ENV]
	if (!stateDir) return
	// prime-agent is ESM-only and a web/server dependency; its pnpm link is stable.
	const cli = resolve(import.meta.dirname, "..", "..", "server", "node_modules", "prime-agent", "dist", "bundle", "cli.js")
	// `shutdown` is scoped to the state root (HOME, agent dir, TMPDIR socket
	// dir), so with the hermetic env it only reaches this run's daemon.
	spawnSync(process.execPath, [cli, "shutdown", "--force", "--json"], {
		env: { ...process.env, ...hermeticServerEnv(stateDir) },
		stdio: "ignore",
		timeout: 30_000,
	})
	if (process.env[SMOKE_STATE_OWNED_ENV] === "1" && process.env.FLEET_SMOKE_KEEP_STATE !== "1") {
		rmSync(stateDir, { recursive: true, force: true })
	}
}
