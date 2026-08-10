/**
 * Standalone probe: does materializeSessionFile() actually write to disk?
 * Run from within the web/ workspace so file: deps resolve.
 */
import { createAgentSession } from "@earendil-works/pi-coding-agent"
import { existsSync, readFileSync } from "node:fs"

const probe = async () => {
	const { session } = await createAgentSession({
		cwd: "/Volumes/SSD-T7/qredence-environnement/fleet-prime-agent/prime-agent/apps/web",
	})
	const pre = session.sessionManager.getSessionId()
	console.log("pre-materialize sessionId:", pre)
	const sessionFile = session.sessionManager.materializeSessionFile()
	const post = session.sessionManager.getSessionId()
	console.log("post-materialize sessionId:", post)
	console.log("sessionFile:", sessionFile)
	console.log("exists on disk?", existsSync(sessionFile))
	if (existsSync(sessionFile)) {
		console.log("first 400 bytes:", readFileSync(sessionFile, "utf8").slice(0, 400))
	}
}

probe().catch((err) => {
	console.error("probe failed:", err)
	process.exit(1)
})
