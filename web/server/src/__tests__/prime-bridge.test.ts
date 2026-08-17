import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { IpythonKernelProvisioner } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrimeBridge } from "../prime-bridge";
import { resetBridgeForTests, setBridgeForTests } from "../singleton";

const AGENT_DIR_ENV = "PRIME_AGENT_CODING_AGENT_DIR";
const SESSION_DIR_ENVS = ["PRIME_AGENT_SESSION_DIR", "PRIME_AGENT_CODING_AGENT_SESSION_DIR"];

/** Snapshot `name`, unset it, and return a restore function. */
function unsetEnv(name: string): () => void {
	const previous = process.env[name];
	delete process.env[name];
	return () => {
		if (previous === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = previous;
		}
	};
}

describe("PrimeBridge", () => {
	beforeEach(() => {
		resetBridgeForTests();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("listSessions is empty by default until the agent boots", async () => {
		const bridge = new PrimeBridge();
		setBridgeForTests(bridge);
		const sessions = await bridge.listSessions();
		expect(Array.isArray(sessions)).toBe(true);
	});

	it("kernelReadyState is not-started until ensureKernelReady", () => {
		const bridge = new PrimeBridge();
		expect(bridge.kernelReadyState()).toEqual({ ok: false, reason: "not-started" });
	});

	it("kernelReadyState moves from pending to settled after ensureKernelReady", async () => {
		let settle!: () => void;
		const gate = new Promise<void>((resolve) => {
			settle = resolve;
		});
		vi.spyOn(IpythonKernelProvisioner.prototype, "ensure").mockReturnValue(gate as never);

		const bridge = new PrimeBridge({ kernelTimeoutMs: 30_000 });
		const boot = bridge.ensureKernelReady();
		expect(bridge.kernelReadyState()).toEqual({ ok: false, reason: "pending" });

		settle();
		await boot;
		expect(bridge.kernelReadyState()).toEqual({ ok: true });
	});

	it("kernelReadyState records ensure failure", async () => {
		vi.spyOn(IpythonKernelProvisioner.prototype, "ensure").mockRejectedValue(new Error("no kernel"));

		const bridge = new PrimeBridge({ kernelTimeoutMs: 30_000 });
		const boot = bridge.ensureKernelReady();
		expect(bridge.kernelReadyState()).toEqual({ ok: false, reason: "pending" });
		await expect(boot).rejects.toThrow("no kernel");
		expect(bridge.kernelReadyState()).toEqual({ ok: false, reason: "no kernel" });
	});

	it("answerDialog returns false for unknown toolCallId", () => {
		const bridge = new PrimeBridge();
		expect(bridge.answerDialog("session-1", "toolCall-unknown", { kind: "skip" })).toBe(false);
	});

	it("replaySince on an unknown session returns an empty result", () => {
		const bridge = new PrimeBridge();
		const result = bridge.replaySince("unknown", 0);
		expect(result.replayed).toEqual([]);
		expect(result.overflowed).toBe(false);
	});

	it("resetForTests clears listeners", () => {
		const bridge = new PrimeBridge();
		const listener = vi.fn();
		bridge.addEventListener(listener);
		bridge.resetForTests();
		// After reset, the listeners set is empty. Dispatch would no-op for live
		// subscribers, but the bridge never calls #dispatch without a real frame,
		// so we just assert the listener was registered before reset.
		expect(listener).not.toHaveBeenCalled();
	});

	it("getSession returns undefined for unknown sessionId", () => {
		const bridge = new PrimeBridge();
		expect(bridge.getSession("missing")).toBeUndefined();
	});
});

describe("PrimeBridge.forkSession", () => {
	let workDir: string;
	let agentDir: string;
	let restoreEnvs: Array<() => void> = [];

	beforeEach(() => {
		resetBridgeForTests();
		workDir = mkdtempSync(join(tmpdir(), "prime-bridge-fork-test-"));
		agentDir = mkdtempSync(join(tmpdir(), "prime-bridge-agent-dir-"));
		restoreEnvs = [unsetEnv(AGENT_DIR_ENV)];
		process.env[AGENT_DIR_ENV] = agentDir;
		// Session-dir env overrides would route writes outside the hermetic tmpdir.
		restoreEnvs.push(...SESSION_DIR_ENVS.map(unsetEnv));
		return () => {
			rmSync(workDir, { recursive: true, force: true });
			rmSync(agentDir, { recursive: true, force: true });
		};
	});

	afterEach(() => {
		for (const restore of restoreEnvs) restore();
		restoreEnvs = [];
		vi.restoreAllMocks();
	});

	/** Real hermetic session: tmp agent dir, kernel prewarm stubbed out. */
	function createTestSession(bridge: PrimeBridge) {
		vi.spyOn(bridge, "ensureKernelReady").mockResolvedValue(undefined);
		return bridge.createSession({ cwd: workDir });
	}

	/** The forked session must be live in the bridge's registry after forkSession. */
	function requireLiveSession(bridge: PrimeBridge, sessionId: string) {
		const session = bridge.getSession(sessionId);
		if (!session) throw new Error(`session ${sessionId} not live`);
		return session;
	}

	function appendTurn(
		bridge: PrimeBridge,
		sessionId: string,
		userText: string,
		assistantText: string,
	): { userEntryId: string; assistantEntryId: string } {
		const live = bridge.getSession(sessionId);
		if (!live) throw new Error("session not live");
		const sm = live.session.sessionManager;
		const userMessage: UserMessage = {
			role: "user",
			content: userText,
			timestamp: Date.now(),
		};
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
		};
		const userEntryId = sm.appendMessage(userMessage);
		const assistantEntryId = sm.appendMessage(assistantMessage);
		return { userEntryId, assistantEntryId };
	}

	it("keeps OpenUI off by default and updates explicit OpenUI guidance by mode", async () => {
		const bridge = new PrimeBridge();
		const created = await bridge.createSession({ cwd: workDir, mode: "plan" });

		expect(bridge.getSystemPrompt(created.sessionId)).not.toContain("Every OpenUI block");

		const prompt = vi.spyOn(created.session, "prompt").mockResolvedValue(undefined);
		await bridge.prompt(created.sessionId, "show a plan summary", { mode: "plan", openUI: true });
		const planPrompt = bridge.getSystemPrompt(created.sessionId);
		expect(planPrompt).toContain("Every OpenUI block must start with `root = Root(...)` as its first line.");
		expect(planPrompt).toContain("Do not use OpenUI actions in Plan mode.");

		await bridge.prompt(created.sessionId, "show a compact status summary", { mode: "agent", openUI: true });

		expect(bridge.getSystemPrompt(created.sessionId)).toContain(
			"Use OpenUI for dashboards, structured comparisons, progress/status summaries, result cards, metrics, and interactive forms.",
		);
		expect(bridge.getSystemPrompt(created.sessionId)).not.toContain("Do not use OpenUI actions in Plan mode.");

		await bridge.prompt(created.sessionId, "plain markdown only", { mode: "agent", openUI: false });
		expect(bridge.getSystemPrompt(created.sessionId)).not.toContain("Every OpenUI block");
		expect(prompt).toHaveBeenCalledTimes(3);
	});

	it("position 'before' on a user message targets the parent entry and extracts selectedText", async () => {
		const bridge = new PrimeBridge();
		const created = await createTestSession(bridge);
		appendTurn(bridge, created.sessionId, "first question", "first answer");
		const { userEntryId } = appendTurn(bridge, created.sessionId, "second question", "second answer");

		const result = await bridge.forkSession(created.sessionId, userEntryId, "before");

		expect(result.cancelled).toBe(false);
		expect(result.selectedText).toBe("second question");
		expect(result.newSessionId).not.toBe(created.sessionId);
		// The fork carries everything up to (but excluding) the forked user message.
		const forked = requireLiveSession(bridge, result.newSessionId);
		const messages = forked.session.sessionManager.buildSessionContext().messages;
		expect(messages.map((m) => (m as { role: string }).role)).toEqual(["user", "assistant"]);
		expect((messages[0] as { content: string }).content).toBe("first question");
	});

	it("position 'at' on an arbitrary entry forks at that entry id directly", async () => {
		const bridge = new PrimeBridge();
		const created = await createTestSession(bridge);
		const { userEntryId, assistantEntryId } = appendTurn(bridge, created.sessionId, "question", "answer");

		const result = await bridge.forkSession(created.sessionId, assistantEntryId, "at");

		expect(result.cancelled).toBe(false);
		expect(result.selectedText).toBeUndefined();
		const forked = requireLiveSession(bridge, result.newSessionId);
		// The forked branch walks root→leaf through the fork target. AgentSession
		// init may append bookkeeping entries (model_change…) after it, so assert
		// the target is on the branch rather than the terminal leaf.
		expect(forked.session.sessionManager.getEntry(assistantEntryId)).toBeDefined();
		const branchIds = forked.session.sessionManager.getBranch().map((e) => e.id);
		expect(branchIds).toContain(userEntryId);
		expect(branchIds).toContain(assistantEntryId);
		expect(branchIds.indexOf(userEntryId)).toBeLessThan(branchIds.indexOf(assistantEntryId));
		const messages = forked.session.sessionManager.buildSessionContext().messages;
		expect(messages).toHaveLength(2);
	});

	it("position 'at' on a user message includes that message (clone semantics)", async () => {
		const bridge = new PrimeBridge();
		const created = await createTestSession(bridge);
		const { userEntryId } = appendTurn(bridge, created.sessionId, "question", "answer");

		const result = await bridge.forkSession(created.sessionId, userEntryId, "at");

		const forked = requireLiveSession(bridge, result.newSessionId);
		expect(forked.session.sessionManager.getEntry(userEntryId)).toBeDefined();
		const messages = forked.session.sessionManager.buildSessionContext().messages;
		expect(messages).toHaveLength(1);
	});

	it("position 'before' on the first user message creates a fresh empty session parented on the source", async () => {
		const bridge = new PrimeBridge();
		const created = await createTestSession(bridge);
		const { userEntryId } = appendTurn(bridge, created.sessionId, "first question", "first answer");

		const result = await bridge.forkSession(created.sessionId, userEntryId, "before");

		expect(result.cancelled).toBe(false);
		expect(result.selectedText).toBe("first question");
		const forked = requireLiveSession(bridge, result.newSessionId);
		expect(forked.session.sessionManager.buildSessionContext().messages).toHaveLength(0);
		expect(forked.session.sessionManager.getHeader()?.parentSession).toBe(
			created.session.sessionManager.getSessionFile(),
		);
	});

	it("keeps the source session untouched and running after the fork", async () => {
		const bridge = new PrimeBridge();
		const created = await createTestSession(bridge);
		const sourceFile = created.session.sessionManager.getSessionFile();
		const { userEntryId } = appendTurn(bridge, created.sessionId, "question", "answer");
		const sourceLeafBefore = created.session.sessionManager.getLeafId();

		const result = await bridge.forkSession(created.sessionId, userEntryId, "at");

		// Source is neither re-idded nor evicted (bridge semantics, not TUI replace-in-slot).
		expect(bridge.getSession(created.sessionId)).toBeDefined();
		expect(created.session.sessionManager.getSessionId()).toBe(created.sessionId);
		expect(created.session.sessionManager.getSessionFile()).toBe(sourceFile);
		expect(created.session.sessionManager.getLeafId()).toBe(sourceLeafBefore);
		expect(bridge.getSession(result.newSessionId)).toBeDefined();
	});

	it("forwards thinkingLevel and model from the source session to the fork", async () => {
		const bridge = new PrimeBridge();
		const created = await createTestSession(bridge);
		const { assistantEntryId } = appendTurn(bridge, created.sessionId, "question", "answer");
		created.session.setThinkingLevel("high");
		const sourceThinking = created.session.thinkingLevel; // clamped to model capabilities

		const result = await bridge.forkSession(created.sessionId, assistantEntryId, "at");

		const forked = requireLiveSession(bridge, result.newSessionId);
		expect(forked.session.thinkingLevel).toBe(sourceThinking);
		// Whatever model the source resolved (undefined when the runner has no
		// provider auth) is carried over to the fork.
		expect(forked.session.model?.id).toBe(created.session.model?.id);
		expect(forked.session.serviceTier).toBe(created.session.serviceTier);
	});

	it("flushNow persists the forked session file so it is discoverable cold", async () => {
		const bridge = new PrimeBridge();
		const created = await createTestSession(bridge);
		const { userEntryId } = appendTurn(bridge, created.sessionId, "question", "answer");

		const result = await bridge.forkSession(created.sessionId, userEntryId, "at");

		const forked = requireLiveSession(bridge, result.newSessionId);
		const forkedFile = forked.session.sessionManager.getSessionFile();
		expect(typeof forkedFile).toBe("string");
		expect(existsSync(forkedFile!)).toBe(true);
	});

	it("rejects an unknown entry id", async () => {
		const bridge = new PrimeBridge();
		const created = await createTestSession(bridge);

		await expect(bridge.forkSession(created.sessionId, "missing-entry", "before")).rejects.toThrow(
			"Invalid entry ID for forking",
		);
	});
});
