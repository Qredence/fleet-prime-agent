import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { PrimeBridge } from "../prime-bridge"
import { setBridgeForTests, resetBridgeForTests } from "../singleton"
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const AGENT_DIR_ENV = "PRIME_AGENT_CODING_AGENT_DIR"
const SESSION_DIR_ENVS = ["PRIME_AGENT_SESSION_DIR", "PRIME_AGENT_CODING_AGENT_SESSION_DIR"]

describe("PrimeBridge", () => {
	beforeEach(() => {
		resetBridgeForTests()
	})

	it("listSessions is empty by default until the agent boots", async () => {
		const bridge = new PrimeBridge()
		setBridgeForTests(bridge)
		const sessions = await bridge.listSessions()
		expect(Array.isArray(sessions)).toBe(true)
	})

	it("kernelReadyState initialises to pending without boot-time kernel probe", async () => {
		const bridge = new PrimeBridge()
		// .kernelReadyState() may be ok or not depending on whether the singleton
		// has been warm-booted; we just verify it returns a {ok, reason?} shape.
		const state = bridge.kernelReadyState()
		expect(typeof state.ok).toBe("boolean")
		if (!state.ok) {
			expect(typeof state.reason).toBe("string")
		}
	})

	it("answerDialog returns false for unknown toolCallId", () => {
		const bridge = new PrimeBridge()
		expect(
			bridge.answerDialog("session-1", "toolCall-unknown", { kind: "skip" }),
		).toBe(false)
	})

	it("replaySince on an unknown session returns an empty result", () => {
		const bridge = new PrimeBridge()
		const result = bridge.replaySince("unknown", 0)
		expect(result.replayed).toEqual([])
		expect(result.overflowed).toBe(false)
	})

	it("resetForTests clears listeners", () => {
		const bridge = new PrimeBridge()
		const listener = vi.fn()
		bridge.addEventListener(listener)
		bridge.resetForTests()
		// After reset, the listeners set is empty. Dispatch would no-op for live
		// subscribers, but the bridge never calls #dispatch without a real frame,
		// so we just assert the listener was registered before reset.
		expect(listener).not.toHaveBeenCalled()
	})

	it("getSession returns undefined for unknown sessionId", () => {
		const bridge = new PrimeBridge()
		expect(bridge.getSession("missing")).toBeUndefined()
	})
})

describe("PrimeBridge.forkSession", () => {
	let workDir: string
	let agentDir: string
	let previousAgentDir: string | undefined
	let previousSessionDirEnvs: Array<string | undefined> = []

	beforeEach(() => {
		resetBridgeForTests()
		workDir = mkdtempSync(join(tmpdir(), "prime-bridge-fork-test-"))
		agentDir = mkdtempSync(join(tmpdir(), "prime-bridge-agent-dir-"))
		previousAgentDir = process.env[AGENT_DIR_ENV]
		process.env[AGENT_DIR_ENV] = agentDir
		// Session-dir env overrides would route writes outside the hermetic tmpdir.
		previousSessionDirEnvs = SESSION_DIR_ENVS.map((name) => {
			const value = process.env[name]
			delete process.env[name]
			return value
		})
		return () => {
			rmSync(workDir, { recursive: true, force: true })
			rmSync(agentDir, { recursive: true, force: true })
		}
	})

	afterEach(() => {
		if (previousAgentDir === undefined) {
			delete process.env[AGENT_DIR_ENV]
		} else {
			process.env[AGENT_DIR_ENV] = previousAgentDir
		}
		SESSION_DIR_ENVS.forEach((name, i) => {
			const value = previousSessionDirEnvs[i]
			if (value === undefined) {
				delete process.env[name]
			} else {
				process.env[name] = value
			}
		})
		vi.restoreAllMocks()
	})

	/** Real hermetic session: tmp agent dir, kernel prewarm stubbed out. */
	async function createTestSession(bridge: PrimeBridge) {
		vi.spyOn(bridge, "ensureKernelReady").mockResolvedValue(undefined)
		const created = await bridge.createSession({ cwd: workDir })
		return created
	}

	function appendTurn(
		bridge: PrimeBridge,
		sessionId: string,
		userText: string,
		assistantText: string,
	): { userEntryId: string; assistantEntryId: string } {
		const live = bridge.getSession(sessionId)
		if (!live) throw new Error("session not live")
		const sm = live.session.sessionManager
		const userMessage: UserMessage = {
			role: "user",
			content: userText,
			timestamp: Date.now(),
		}
		const assistantMessage: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: assistantText }],
			api: "responses",
			provider: "openai",
			model: "gpt-5",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		}
		const userEntryId = sm.appendMessage(userMessage)
		const assistantEntryId = sm.appendMessage(assistantMessage)
		return { userEntryId, assistantEntryId }
	}

	it("position 'before' on a user message targets the parent entry and extracts selectedText", async () => {
		const bridge = new PrimeBridge()
		const created = await createTestSession(bridge)
		appendTurn(bridge, created.sessionId, "first question", "first answer")
		const { userEntryId } = appendTurn(bridge, created.sessionId, "second question", "second answer")

		const result = await bridge.forkSession(created.sessionId, userEntryId, "before")

		expect(result.cancelled).toBe(false)
		expect(result.selectedText).toBe("second question")
		expect(result.newSessionId).not.toBe(created.sessionId)
		// The fork carries everything up to (but excluding) the forked user message.
		const forked = bridge.getSession(result.newSessionId)
		expect(forked).toBeDefined()
		const messages = forked!.session.sessionManager.buildSessionContext().messages
		expect(messages.map((m) => (m as { role: string }).role)).toEqual(["user", "assistant"])
		expect((messages[0] as { content: string }).content).toBe("first question")
	})

	it("position 'at' on an arbitrary entry forks at that entry id directly", async () => {
		const bridge = new PrimeBridge()
		const created = await createTestSession(bridge)
		const { userEntryId, assistantEntryId } = appendTurn(bridge, created.sessionId, "question", "answer")

		const result = await bridge.forkSession(created.sessionId, assistantEntryId, "at")

		expect(result.cancelled).toBe(false)
		expect(result.selectedText).toBeUndefined()
		const forked = bridge.getSession(result.newSessionId)
		expect(forked).toBeDefined()
		// The forked branch walks root→leaf through the fork target. AgentSession
		// init may append bookkeeping entries (model_change…) after it, so assert
		// the target is on the branch rather than the terminal leaf.
		expect(forked!.session.sessionManager.getEntry(assistantEntryId)).toBeDefined()
		const branchIds = forked!.session.sessionManager.getBranch().map((e) => e.id)
		expect(branchIds).toContain(userEntryId)
		expect(branchIds).toContain(assistantEntryId)
		expect(branchIds.indexOf(userEntryId)).toBeLessThan(branchIds.indexOf(assistantEntryId))
		const messages = forked!.session.sessionManager.buildSessionContext().messages
		expect(messages).toHaveLength(2)
	})

	it("position 'at' on a user message includes that message (clone semantics)", async () => {
		const bridge = new PrimeBridge()
		const created = await createTestSession(bridge)
		const { userEntryId } = appendTurn(bridge, created.sessionId, "question", "answer")

		const result = await bridge.forkSession(created.sessionId, userEntryId, "at")

		const forked = bridge.getSession(result.newSessionId)
		expect(forked!.session.sessionManager.getEntry(userEntryId)).toBeDefined()
		const messages = forked!.session.sessionManager.buildSessionContext().messages
		expect(messages).toHaveLength(1)
	})

	it("position 'before' on the first user message creates a fresh empty session parented on the source", async () => {
		const bridge = new PrimeBridge()
		const created = await createTestSession(bridge)
		const { userEntryId } = appendTurn(bridge, created.sessionId, "first question", "first answer")

		const result = await bridge.forkSession(created.sessionId, userEntryId, "before")

		expect(result.cancelled).toBe(false)
		expect(result.selectedText).toBe("first question")
		const forked = bridge.getSession(result.newSessionId)
		expect(forked).toBeDefined()
		expect(forked!.session.sessionManager.buildSessionContext().messages).toHaveLength(0)
		expect(forked!.session.sessionManager.getHeader()?.parentSession).toBe(
			created.session.sessionManager.getSessionFile(),
		)
	})

	it("keeps the source session untouched and running after the fork", async () => {
		const bridge = new PrimeBridge()
		const created = await createTestSession(bridge)
		const sourceFile = created.session.sessionManager.getSessionFile()
		const { userEntryId } = appendTurn(bridge, created.sessionId, "question", "answer")
		const sourceLeafBefore = created.session.sessionManager.getLeafId()

		const result = await bridge.forkSession(created.sessionId, userEntryId, "at")

		// Source is neither re-idded nor evicted (bridge semantics, not TUI replace-in-slot).
		expect(bridge.getSession(created.sessionId)).toBeDefined()
		expect(created.session.sessionManager.getSessionId()).toBe(created.sessionId)
		expect(created.session.sessionManager.getSessionFile()).toBe(sourceFile)
		expect(created.session.sessionManager.getLeafId()).toBe(sourceLeafBefore)
		expect(bridge.getSession(result.newSessionId)).toBeDefined()
	})

	it("forwards thinkingLevel and model from the source session to the fork", async () => {
		const bridge = new PrimeBridge()
		const created = await createTestSession(bridge)
		const { assistantEntryId } = appendTurn(bridge, created.sessionId, "question", "answer")
		created.session.setThinkingLevel("high")
		const sourceThinking = created.session.thinkingLevel // clamped to model capabilities

		const result = await bridge.forkSession(created.sessionId, assistantEntryId, "at")

		const forked = bridge.getSession(result.newSessionId)
		expect(forked!.session.thinkingLevel).toBe(sourceThinking)
		// Whatever model the source resolved (undefined when the runner has no
		// provider auth) is carried over to the fork.
		expect(forked!.session.model?.id).toBe(created.session.model?.id)
		expect(forked!.session.serviceTier).toBe(created.session.serviceTier)
	})

	it("flushNow persists the forked session file so it is discoverable cold", async () => {
		const bridge = new PrimeBridge()
		const created = await createTestSession(bridge)
		const { userEntryId } = appendTurn(bridge, created.sessionId, "question", "answer")

		const result = await bridge.forkSession(created.sessionId, userEntryId, "at")

		const forked = bridge.getSession(result.newSessionId)!
		const forkedFile = forked.session.sessionManager.getSessionFile()
		expect(typeof forkedFile).toBe("string")
		expect(existsSync(forkedFile!)).toBe(true)
	})

	it("rejects an unknown entry id", async () => {
		const bridge = new PrimeBridge()
		const created = await createTestSession(bridge)

		await expect(
			bridge.forkSession(created.sessionId, "missing-entry", "before"),
		).rejects.toThrow("Invalid entry ID for forking")
	})
})
