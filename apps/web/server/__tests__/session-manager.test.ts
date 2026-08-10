import { describe, expect, it, beforeEach } from "vitest"
import { SessionManager } from "@earendil-works/pi-coding-agent"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("SessionManager", () => {
	let workDir: string
	let sessionDir: string

	beforeEach(() => {
		workDir = mkdtempSync(join(tmpdir(), "prime-session-manager-test-"))
		sessionDir = join(workDir, "sessions")
		return () => {
			rmSync(workDir, { recursive: true, force: true })
		}
	})

	it("materializeSessionFile returns a planned path without eagerly writing to disk", () => {
		const sm = SessionManager.create(workDir, sessionDir)
		const target = sm.materializeSessionFile()
		expect(typeof target).toBe("string")
		expect(target.length).toBeGreaterThan(0)
		expect(existsSync(target)).toBe(false)
	})

	it("flushNow persists the session file whose first line is a JSONL header with an id", () => {
		const sm = SessionManager.create(workDir, sessionDir)
		const target = sm.materializeSessionFile()
		sm.flushNow()
		expect(existsSync(target)).toBe(true)
		const head = readFileSync(target, "utf8").slice(0, 4096)
		const newlineAt = head.indexOf("\n")
		expect(newlineAt).toBeGreaterThan(-1)
		// First JSONL line is the session header. Its byte length varies with the
		// test-run cwd and embedded git context (217 under a tmpdir, ~190 inside
		// the repo), so parse the complete line rather than a fixed 200 budget.
		const header = JSON.parse(head.slice(0, newlineAt)) as { id?: unknown }
		expect(typeof header.id).toBe("string")
	})

	it("openAsync round-trips a flushed session file with the same sessionId and cwd", async () => {
		const sm = SessionManager.create(workDir, sessionDir)
		const target = sm.materializeSessionFile()
		sm.flushNow()
		const reopened = await SessionManager.openAsync(target)
		expect(reopened.getSessionId()).toBe(sm.getSessionId())
		expect(reopened.getCwd()).toBe(workDir)
	})
})
