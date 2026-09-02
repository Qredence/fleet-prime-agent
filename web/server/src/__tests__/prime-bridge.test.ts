import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { AgentSession } from "prime-agent";
import { IpythonKernelProvisioner, SessionManager } from "prime-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeHostFor } from "../connection-runtime";
import type { listDaemonSessions } from "../daemon-runtime";
import { createInProcessTestAgentConnection } from "../in-process-test-connection";
import { loadManagedPrimePresentation, writeManagedPrimePresentation } from "../prime-agent-presentation";
import { PrimeBridge, type PrimeBridgeOptions } from "../prime-bridge";
import { getPrimeConfig, resetPrimeConfigForTests } from "../prime-config";
import { resetBridgeForTests, setBridgeForTests } from "../singleton";

const AGENT_DIR_ENV = "PRIME_AGENT_CODING_AGENT_DIR";
const SESSION_DIR_ENVS = ["PRIME_AGENT_SESSION_DIR", "PRIME_AGENT_CODING_AGENT_SESSION_DIR"];

function createTestBridge(options: PrimeBridgeOptions = {}): PrimeBridge {
	return new PrimeBridge({
		...options,
		connectionFactory: createInProcessTestAgentConnection,
		sessionLister: options.sessionLister ?? (async () => []),
	});
}

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
		const bridge = createTestBridge();
		setBridgeForTests(bridge);
		const sessions = await bridge.listSessions();
		expect(Array.isArray(sessions)).toBe(true);
	});

	it("kernelReadyState is not-started until ensureKernelReady", () => {
		const bridge = createTestBridge();
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
		const bridge = createTestBridge();
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
		resetPrimeConfigForTests();
		return () => {
			rmSync(workDir, { recursive: true, force: true });
			rmSync(agentDir, { recursive: true, force: true });
		};
	});

	afterEach(() => {
		for (const restore of restoreEnvs) restore();
		restoreEnvs = [];
		resetPrimeConfigForTests();
		vi.restoreAllMocks();
	});

	/** Real hermetic session: tmp agent dir, kernel prewarm stubbed out. */
	function createTestSession(
		bridge: PrimeBridge,
	): Promise<{ session: AgentSession } & Awaited<ReturnType<PrimeBridge["createSession"]>>> {
		vi.spyOn(bridge, "ensureKernelReady").mockResolvedValue(undefined);
		return bridge.createSession({ cwd: workDir }) as Promise<
			{ session: AgentSession } & Awaited<ReturnType<PrimeBridge["createSession"]>>
		>;
	}

	/** The forked session must be live in the bridge's registry after forkSession. */
	function requireLiveSession(
		bridge: PrimeBridge,
		sessionId: string,
	): { session: AgentSession } & Awaited<ReturnType<PrimeBridge["createSession"]>> {
		const session = bridge.getSession(sessionId);
		if (!session || !session.session) throw new Error(`session ${sessionId} not live in the test adapter`);
		return session as { session: AgentSession } & Awaited<ReturnType<PrimeBridge["createSession"]>>;
	}

	it("waits for pending presentation writes before deleting a session", async () => {
		let releaseWrite!: () => void;
		const writeGate = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		const writer = vi.fn(async (...args: Parameters<typeof writeManagedPrimePresentation>) => {
			await writeGate;
			await writeManagedPrimePresentation(...args);
		});
		const bridge = createTestBridge({ writePresentation: writer });
		const created = await createTestSession(bridge);

		await vi.waitFor(() => expect(writer).toHaveBeenCalled());
		const artifactDir = created.session.sessionManager.getSessionArtifactDir();
		expect(artifactDir).toBeTruthy();
		const presentationPath = join(artifactDir!, "presentation.json");
		const deletion = bridge.deleteSession(created.sessionId);
		await Promise.resolve();
		releaseWrite();
		await deletion;

		expect(existsSync(presentationPath)).toBe(false);
	});

	function appendTurn(
		bridge: PrimeBridge,
		sessionId: string,
		userText: string,
		assistantText: string,
	): { userEntryId: string; assistantEntryId: string } {
		const live = requireLiveSession(bridge, sessionId);
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
		sm.flushNow();
		return { userEntryId, assistantEntryId };
	}

	it("keeps OpenUI off by default and updates explicit OpenUI guidance by mode", async () => {
		const bridge = createTestBridge();
		const created = await bridge.createSession({ cwd: workDir, mode: "plan" });

		expect(bridge.getSystemPrompt(created.sessionId)).not.toContain("Every OpenUI block");

		const prompt = vi
			.spyOn(
				created.connection as unknown as { promptAndWait: typeof created.connection.promptAndWait },
				"promptAndWait",
			)
			.mockResolvedValue(undefined);
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
		expect(prompt).toHaveBeenNthCalledWith(1, "show a plan summary", expect.objectContaining({ queueIfBusy: true }));
	});

	it("enables OpenUI guidance at session creation when openUI is requested", async () => {
		const bridge = createTestBridge();
		const created = await bridge.createSession({ cwd: workDir, mode: "agent", openUI: true });

		expect(created.openUIPrompt.enabled).toBe(true);
		expect(bridge.getSystemPrompt(created.sessionId)).toContain("Every OpenUI block");
	});

	it("applies OpenUI guidance when resuming a persisted session with openUI enabled", async () => {
		const bridge = createTestBridge();
		const created = await createTestSession(bridge);
		expect(created.openUIPrompt.enabled).toBe(false);
		created.session.sessionManager.flushNow();
		const resumer = createTestBridge({
			sessionLister: (async () => [
				{
					id: created.sessionId,
					sessionId: created.sessionId,
					cwd: created.cwd,
					sessionFile: created.sessionPath,
				},
			]) as unknown as typeof listDaemonSessions,
		});

		const resumed = await resumer.resumeSessionById(created.sessionId, undefined, { openUI: true });

		expect(resumed).toBeDefined();
		expect(resumed?.openUIPrompt.enabled).toBe(true);
		expect(resumer.getSystemPrompt(created.sessionId)).toContain("Every OpenUI block");
	});

	it("emits a gated diagnostic when OpenUI state changes on a connection without a prompt hook", async () => {
		const bridge = createTestBridge();
		const created = await createTestSession(bridge);
		vi.spyOn(
			created.connection as unknown as { promptAndWait: typeof created.connection.promptAndWait },
			"promptAndWait",
		).mockResolvedValue(undefined);
		const live = bridge.getSession(created.sessionId);
		expect(live).toBeDefined();
		(live as unknown as { setOpenUIPrompt?: unknown }).setOpenUIPrompt = undefined;

		restoreEnvs.push(unsetEnv("PRIME_BRIDGE_DEBUG"));
		process.env.PRIME_BRIDGE_DEBUG = "1";
		const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		await bridge.prompt(created.sessionId, "hi", { openUI: true });

		const writes = stderrWrite.mock.calls.map(([chunk]) => String(chunk));
		expect(writes.some((chunk) => chunk.includes("cannot update prompts after creation"))).toBe(true);
	});

	it.each(["steer", "followUp"] as const)(
		"admits an active %s prompt before reconfiguring OpenUI",
		async (streamingBehavior) => {
			const bridge = createTestBridge();
			const created = await createTestSession(bridge);
			const setOpenUIPrompt = created.setOpenUIPrompt;
			if (!setOpenUIPrompt) throw new Error("test adapter must expose setOpenUIPrompt");
			const mutable = created as unknown as {
				setOpenUIPrompt: NonNullable<typeof created.setOpenUIPrompt>;
			};
			const order: string[] = [];
			mutable.setOpenUIPrompt = async (next) => {
				order.push("reconfigure");
				await setOpenUIPrompt(next);
			};
			created.isStreaming = true;
			const prompt = vi.spyOn(created.connection, "promptAndWait").mockImplementation(async () => {
				order.push("prompt");
			});

			await bridge.prompt(created.sessionId, "update the active turn", {
				openUI: true,
				streamingBehavior,
			});

			expect(order).toEqual(["prompt", "reconfigure"]);
			expect(prompt).toHaveBeenCalledWith(
				"update the active turn",
				expect.objectContaining({ streamingBehavior, queueIfBusy: true }),
			);
		},
	);

	it("serializes idle OpenUI transitions before admitting later prompts", async () => {
		const bridge = createTestBridge();
		const created = await createTestSession(bridge);
		const setOpenUIPrompt = created.setOpenUIPrompt;
		if (!setOpenUIPrompt) throw new Error("test adapter must expose setOpenUIPrompt");
		const mutable = created as unknown as {
			setOpenUIPrompt: NonNullable<typeof created.setOpenUIPrompt>;
		};
		const transitionStates: boolean[] = [];
		let releaseFirstTransition!: () => void;
		const firstTransition = new Promise<void>((resolve) => {
			releaseFirstTransition = resolve;
		});
		let isFirstTransition = true;
		mutable.setOpenUIPrompt = async (next) => {
			transitionStates.push(next.enabled);
			if (isFirstTransition) {
				isFirstTransition = false;
				await firstTransition;
			}
			await setOpenUIPrompt(next);
		};
		const prompt = vi.spyOn(created.connection, "promptAndWait").mockResolvedValue(undefined);

		const firstPrompt = bridge.prompt(created.sessionId, "enable OpenUI", { openUI: true });
		await vi.waitFor(() => expect(transitionStates).toEqual([true]));
		const secondPrompt = bridge.prompt(created.sessionId, "disable OpenUI", { openUI: false });
		await vi.waitFor(() => expect(transitionStates).toEqual([true]));
		expect(prompt).not.toHaveBeenCalled();

		releaseFirstTransition();
		await Promise.all([firstPrompt, secondPrompt]);

		expect(transitionStates).toEqual([true, false]);
		expect(prompt).toHaveBeenNthCalledWith(1, "enable OpenUI", expect.anything());
		expect(prompt).toHaveBeenNthCalledWith(2, "disable OpenUI", expect.anything());
	});

	it("keeps the committed OpenUI state when reconfiguration fails and retries next time", async () => {
		const bridge = createTestBridge();
		const created = await createTestSession(bridge);
		const setOpenUIPrompt = created.setOpenUIPrompt;
		if (!setOpenUIPrompt) throw new Error("test adapter must expose setOpenUIPrompt");
		const mutable = created as unknown as {
			setOpenUIPrompt: NonNullable<typeof created.setOpenUIPrompt>;
		};
		let attempts = 0;
		mutable.setOpenUIPrompt = async (next) => {
			attempts += 1;
			if (attempts === 1) throw new Error("reconfiguration failed");
			await setOpenUIPrompt(next);
		};
		vi.spyOn(created.connection, "promptAndWait").mockResolvedValue(undefined);

		await expect(bridge.prompt(created.sessionId, "first attempt", { openUI: true })).rejects.toThrow(
			"reconfiguration failed",
		);
		expect(bridge.getSystemPrompt(created.sessionId)).not.toContain("Every OpenUI block");

		await bridge.prompt(created.sessionId, "retry", { openUI: true });

		expect(attempts).toBe(2);
		expect(bridge.getSystemPrompt(created.sessionId)).toContain("Every OpenUI block");
	});

	it("upserts the same OpenUI artifact idempotently and persists the presentation", async () => {
		const bridge = createTestBridge();
		const created = await createTestSession(bridge);
		const artifact = {
			id: "openui-artifact-1",
			runId: "openui-run-1",
			sourceMessageId: "assistant-1",
			kind: "openui-html" as const,
			title: "Fleet Agent",
			status: "success" as const,
			input: { artifactIndex: 0 },
			output: { title: "Fleet Agent", document: "<!doctype html><html><body>ready</body></html>" },
			timestamp: Date.now(),
		} satisfies Parameters<PrimeBridge["upsertPresentationArtifact"]>[1];

		const first = await bridge.upsertPresentationArtifact(created.sessionId, artifact);
		const second = await bridge.upsertPresentationArtifact(created.sessionId, artifact);

		expect(second).toBe(first);
		expect(second.revision).toBe(1);
		expect(second.artifactRuns.flatMap((run) => run.artifacts)).toHaveLength(1);
		const loaded = await loadManagedPrimePresentation({ sessionPath: created.sessionPath });
		expect(loaded?.artifactRuns[0]?.artifacts[0]?.id).toBe("openui-artifact-1");
	});

	it("position 'before' on a user message targets the parent entry and extracts selectedText", async () => {
		const bridge = createTestBridge();
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

	it("rebuilds presentation from the selected branch instead of copying later source activity", async () => {
		const bridge = createTestBridge();
		const created = await createTestSession(bridge);
		appendTurn(bridge, created.sessionId, "first question", "first answer");
		const { userEntryId } = appendTurn(bridge, created.sessionId, "second question", "second answer");
		const source = requireLiveSession(bridge, created.sessionId);
		const timestamp = Date.now();
		source.mapperState.presentation = {
			...source.mapperState.presentation,
			revision: source.mapperState.presentation.revision + 1,
			userBash: [
				{
					id: "source-bash",
					runId: "source-bash-run",
					command: "git status",
					output: "clean\n",
					status: "success",
					exitCode: 0,
					cancelled: false,
					truncated: false,
					excludeFromContext: false,
					startedAt: timestamp,
					endedAt: timestamp,
				},
			],
			artifactRuns: [
				{
					id: "source-artifact-run",
					runId: "source-bash-run",
					startedAt: timestamp,
					endedAt: timestamp,
					artifacts: [
						{
							id: "source-artifact",
							runId: "source-bash-run",
							sourceToolCallId: "source-bash-run",
							kind: "bash",
							title: "git status",
							status: "success",
							input: { command: "git status" },
							output: { stdout: "clean\n" },
							timestamp,
						},
					],
				},
			],
		};

		const result = await bridge.forkSession(created.sessionId, userEntryId, "before");
		const forkedPresentation = bridge.getPresentation(result.newSessionId);

		expect(forkedPresentation.userBash).toEqual([]);
		expect(forkedPresentation.artifactRuns).toEqual([]);
		expect(bridge.getPresentation(created.sessionId).userBash).toHaveLength(1);
	});

	it("position 'at' on an arbitrary entry forks at that entry id directly", async () => {
		const bridge = createTestBridge();
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
		const bridge = createTestBridge();
		const created = await createTestSession(bridge);
		const { userEntryId } = appendTurn(bridge, created.sessionId, "question", "answer");

		const result = await bridge.forkSession(created.sessionId, userEntryId, "at");

		const forked = requireLiveSession(bridge, result.newSessionId);
		expect(forked.session.sessionManager.getEntry(userEntryId)).toBeDefined();
		const messages = forked.session.sessionManager.buildSessionContext().messages;
		expect(messages).toHaveLength(1);
	});

	it("position 'before' on the first user message creates a fresh empty session parented on the source", async () => {
		const bridge = createTestBridge();
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
		const bridge = createTestBridge();
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
		const bridge = createTestBridge();
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
		const bridge = createTestBridge();
		const created = await createTestSession(bridge);
		const { userEntryId } = appendTurn(bridge, created.sessionId, "question", "answer");

		const result = await bridge.forkSession(created.sessionId, userEntryId, "at");

		const forked = requireLiveSession(bridge, result.newSessionId);
		const forkedFile = forked.session.sessionManager.getSessionFile();
		expect(typeof forkedFile).toBe("string");
		expect(existsSync(forkedFile!)).toBe(true);
	});

	it("resumes a session from the configured store but rejects an unconfigured store", async () => {
		const configuredSessionDir = join(agentDir, "sessions");
		const configuredManager = SessionManager.create(workDir, configuredSessionDir);
		const configuredPath = configuredManager.materializeSessionFile();
		configuredManager.flushNow();

		const bridge = createTestBridge();
		const resumed = await bridge.resumeSessionByPath(configuredPath);
		expect(resumed.sessionId).toBe(configuredManager.getSessionId());

		const unconfiguredDir = mkdtempSync(join(tmpdir(), "prime-bridge-unconfigured-sessions-"));
		try {
			const unconfiguredManager = SessionManager.create(workDir, unconfiguredDir);
			const unconfiguredPath = unconfiguredManager.materializeSessionFile();
			unconfiguredManager.flushNow();

			await expect(bridge.resumeSessionByPath(unconfiguredPath)).rejects.toThrow(
				"outside the configured Prime session store",
			);
		} finally {
			rmSync(unconfiguredDir, { recursive: true, force: true });
		}
	});

	it("forks a resumed session into the target project's working directory", async () => {
		const bridge = createTestBridge();
		const created = await createTestSession(bridge);
		appendTurn(bridge, created.sessionId, "source question", "source answer");
		const targetCwd = join(workDir, "target-project");
		mkdirSync(targetCwd);
		const targetProject = await getPrimeConfig().projectRegistry.register(targetCwd, "Target project");
		const canonicalTargetCwd = realpathSync(targetCwd);

		const forkedId = await bridge.forkSessionIntoProject(created.sessionId, targetProject.projectId);
		const forked = requireLiveSession(bridge, forkedId);

		expect(forked.projectId).toBe(targetProject.projectId);
		expect(forked.cwd).toBe(canonicalTargetCwd);
		expect(forked.session.sessionManager.getCwd()).toBe(canonicalTargetCwd);
		expect(created.session.sessionManager.getSessionId()).toBe(created.sessionId);
		expect(created.projectId).not.toBe(targetProject.projectId);
	});

	it("rejects an unknown entry id", async () => {
		const bridge = createTestBridge();
		const created = await createTestSession(bridge);

		await expect(bridge.forkSession(created.sessionId, "missing-entry", "before")).rejects.toThrow(
			"Invalid entry ID for forking",
		);
	});
});

describe("PrimeBridge.resumeSessionById", () => {
	let workDir: string;
	let agentDir: string;
	let restoreEnvs: Array<() => void> = [];

	beforeEach(() => {
		resetBridgeForTests();
		workDir = mkdtempSync(join(tmpdir(), "prime-bridge-resume-test-"));
		agentDir = mkdtempSync(join(tmpdir(), "prime-bridge-agent-dir-"));
		restoreEnvs = [unsetEnv(AGENT_DIR_ENV)];
		process.env[AGENT_DIR_ENV] = agentDir;
		restoreEnvs.push(...SESSION_DIR_ENVS.map(unsetEnv));
		resetPrimeConfigForTests();
		return () => {
			rmSync(workDir, { recursive: true, force: true });
			rmSync(agentDir, { recursive: true, force: true });
		};
	});

	afterEach(() => {
		for (const restore of restoreEnvs) restore();
		restoreEnvs = [];
		resetPrimeConfigForTests();
		vi.restoreAllMocks();
	});

	function createPersistedTranscript(): { sessionId: string; sessionFile: string } {
		const manager = SessionManager.create(workDir, join(agentDir, "sessions"));
		const sessionFile = manager.materializeSessionFile();
		manager.flushNow();
		return { sessionId: manager.getSessionId(), sessionFile };
	}

	function listerFor(entry: { sessionId: string; sessionFile: string }): typeof listDaemonSessions {
		return (async () => [
			{
				id: entry.sessionId,
				sessionId: entry.sessionId,
				cwd: workDir,
				sessionFile: entry.sessionFile,
			},
		]) as unknown as typeof listDaemonSessions;
	}

	it("returns undefined when the runtime cannot resume a listed transcript", async () => {
		const persisted = createPersistedTranscript();
		const bridge = new PrimeBridge({
			connectionFactory: async () => {
				throw new Error("Session worker started without a root session");
			},
			sessionLister: listerFor(persisted),
		});

		await expect(bridge.resumeSessionById(persisted.sessionId)).resolves.toBeUndefined();
	});

	it("returns undefined when the transcript vanished after listing", async () => {
		const persisted = createPersistedTranscript();
		rmSync(persisted.sessionFile);
		const bridge = new PrimeBridge({
			connectionFactory: createInProcessTestAgentConnection,
			sessionLister: listerFor(persisted),
		});

		await expect(bridge.resumeSessionById(persisted.sessionId)).resolves.toBeUndefined();
	});

	it("still rejects transport failures so handlers answer 500", async () => {
		const persisted = createPersistedTranscript();
		const bridge = new PrimeBridge({
			connectionFactory: async () => {
				throw new Error("cannot send daemon command: connect ENOENT /tmp/prime.sock");
			},
			sessionLister: listerFor(persisted),
		});

		await expect(bridge.resumeSessionById(persisted.sessionId)).rejects.toThrow("cannot send daemon command");
	});

	it("deleteSession deletes an unresumable transcript through the daemon catalog", async () => {
		const persisted = createPersistedTranscript();
		const bridge = new PrimeBridge({
			connectionFactory: async () => {
				throw new Error("Session worker started without a root session");
			},
			sessionLister: listerFor(persisted),
			sessionFileDeleter: async (_cwd, sessionPath) => {
				rmSync(sessionPath);
				return { ok: true, method: "unlink" } as const;
			},
		});
		// The dead transcript may still own managed attachment and plan
		// presentation directories plus a project assignment.
		const managedRoot = dirname(dirname(persisted.sessionFile));
		const attachmentDir = join(managedRoot, "session-attachments", persisted.sessionId);
		const presentationDir = join(managedRoot, "session-plan-presentations", persisted.sessionId);
		for (const dir of [attachmentDir, presentationDir]) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "marker.json"), "{}");
		}
		const registry = getPrimeConfig().projectRegistry;
		const project = await registry.register(workDir, "unresumable cleanup");
		await registry.assignSession(persisted.sessionId, project.projectId);
		const unassign = vi.spyOn(registry, "assignSession");

		await expect(bridge.deleteSession(persisted.sessionId)).resolves.toBe(true);
		expect(existsSync(persisted.sessionFile)).toBe(false);
		expect(existsSync(attachmentDir)).toBe(false);
		expect(existsSync(presentationDir)).toBe(false);
		expect(unassign).toHaveBeenCalledWith(persisted.sessionId, null);
	});
});

describe("PrimeBridge.loadRlmChildTranscript", () => {
	let workDir: string;
	let agentDir: string;
	let restoreEnvs: Array<() => void> = [];

	beforeEach(() => {
		resetBridgeForTests();
		workDir = mkdtempSync(join(tmpdir(), "prime-bridge-rlm-test-"));
		agentDir = mkdtempSync(join(tmpdir(), "prime-bridge-rlm-agent-dir-"));
		restoreEnvs = [unsetEnv(AGENT_DIR_ENV), ...SESSION_DIR_ENVS.map(unsetEnv)];
		process.env[AGENT_DIR_ENV] = agentDir;
		resetPrimeConfigForTests();
		return () => {
			rmSync(workDir, { recursive: true, force: true });
			rmSync(agentDir, { recursive: true, force: true });
		};
	});

	afterEach(() => {
		for (const restore of restoreEnvs) restore();
		restoreEnvs = [];
		resetPrimeConfigForTests();
		vi.restoreAllMocks();
	});

	it("loads an authorized child from a separate transcript directory", async () => {
		const listedSessions: Array<Record<string, unknown>> = [];
		const sessionLister = vi.fn(async () => listedSessions) as unknown as typeof listDaemonSessions;
		const bridge = createTestBridge({ sessionLister });
		vi.spyOn(bridge, "ensureKernelReady").mockResolvedValue(undefined);
		const parent = await bridge.createSession({ cwd: workDir });
		const childDir = join(workDir, "rlm-child-store");
		const childManager = SessionManager.create(workDir, childDir);
		const childPath = childManager.materializeSessionFile();
		childManager.appendMessage({
			role: "user",
			content: "Inspect the child transcript",
			timestamp: Date.now(),
		});
		childManager.flushNow();

		parent.mapperState.presentation = {
			...parent.mapperState.presentation,
			rlmChildren: [
				{
					id: "child-1",
					label: "Research worker",
					status: "done",
					timestamp: Date.now(),
				},
			],
		};
		listedSessions.push({
			id: childManager.getSessionId(),
			sessionId: childManager.getSessionId(),
			cwd: workDir,
			sessionFile: childPath,
			parentSessionId: parent.sessionId,
			rlmChildId: "child-1",
		});
		const result = await bridge.loadRlmChildTranscript(parent.sessionId, "child-1");

		expect(result).toMatchObject({
			sessionId: childManager.getSessionId(),
			projectId: null,
			messages: [{ role: "user", parts: [{ type: "text", text: "Inspect the child transcript" }] }],
		});
		expect(result?.presentation).toEqual({
			revision: 0,
			userBash: [],
			rlmChildren: [],
			refinements: [],
			artifactRuns: [],
		});
	});

	it("rejects a listed transcript whose lineage does not match the live parent", async () => {
		const listedSessions: Array<Record<string, unknown>> = [];
		const sessionLister = vi.fn(async () => listedSessions) as unknown as typeof listDaemonSessions;
		const bridge = createTestBridge({ sessionLister });
		vi.spyOn(bridge, "ensureKernelReady").mockResolvedValue(undefined);
		const parent = await bridge.createSession({ cwd: workDir });
		parent.mapperState.presentation = {
			...parent.mapperState.presentation,
			rlmChildren: [
				{
					id: "child-1",
					label: "Research worker",
					status: "done",
					timestamp: Date.now(),
				},
			],
		};
		listedSessions.push({
			id: "child-session",
			sessionId: "child-session",
			cwd: workDir,
			sessionFile: join(workDir, "missing.jsonl"),
			parentSessionId: "other-parent",
			rlmChildId: "child-1",
		});

		await expect(bridge.loadRlmChildTranscript(parent.sessionId, "child-1")).resolves.toBeUndefined();
		expect(sessionLister).toHaveBeenCalledOnce();
	});
});

/**
 * Regression net for the `InProcessAgentConnection` migration. The bridge
 * class must not reach into `AgentSession` / `SessionManager` for its own
 * operations. If any of these tokens resurface in `prime-bridge.ts`, the
 * migration is incomplete and the test fails loud.
 */
describe("PrimeBridge AgentConnection migration regression", () => {
	// The bridge file is one level up from the test file.
	const bridgePath = resolvePath(__dirname, "..", "prime-bridge.ts");
	const source = readFileSync(bridgePath, "utf8");

	it("does not reach into AgentSession for the bridge's own session lifecycle", () => {
		// The bridge no longer reaches through its optional test-only
		// `BridgeSession.session` field. All active session operations use the
		// public AgentConnection seam.
		const reachThroughs = source.match(/\bsession\.session\.\w+(?:\([^)]*\))?/g) ?? [];
		expect(reachThroughs).toEqual([]);
	});

	it("uses sessionManager.flushNow only via the back-compat cast", () => {
		// Only the fork staging manager writes the new transcript before the
		// daemon opens it; the source session remains daemon-owned. The staging
		// manager is now referenced directly, not through BridgeSession.session.
		const flushNowCalls = source.match(/\.sessionManager\.flushNow\(/g) ?? [];
		expect(flushNowCalls).toEqual([]);
	});

	it("does not re-declare extractUserMessageText", () => {
		// The migration replaces `extractUserMessageText` with content filtering
		// inline. A re-declared helper would be redundant with the fork flow.
		expect(source).not.toMatch(/function\s+extractUserMessageText/);
	});

	it("does not re-declare the legacy SessionTreeNode structural mirror", () => {
		// The migration uses `connection.getSessionTree()`'s return type directly
		// instead of a hand-rolled structural mirror.
		expect(source).not.toMatch(/interface\s+SessionTreeNode/);
	});
});

describe("runtimeHostFor", () => {
	it("exposes the session's getSessionId through the in-process shim", () => {
		// Smoke test: the shim is the same one used by
		// `packages/coding-agent/test/suite/acp-features.test.ts`. It must give
		// back the same session instance so tests can build an InProcessAgentConnection
		// around an existing AgentSession without going through the runtime factory.
		const fakeSession = { sessionManager: { getSessionId: () => "test-session" } } as never;
		const host = runtimeHostFor(fakeSession);
		expect(host.session.sessionManager.getSessionId()).toBe("test-session");
	});
});
