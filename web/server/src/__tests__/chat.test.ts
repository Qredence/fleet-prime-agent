import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleChatPost } from "../handlers/chat";
import { handleChatNewPost } from "../handlers/chat-new";
import { sessionStatus } from "../handlers/projects";
import type { BridgeSession, PrimeBridge } from "../prime-bridge";
import { sessionCommandResultText } from "../session-commands";
import { resetBridgeForTests, setBridgeForTests } from "../singleton";

describe("handleChatPost attachment validation", () => {
	let root: string;
	let session: BridgeSession;
	let prompt: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "prime-chat-attachments-"));
		session = {
			sessionId: "session-1",
			sessionPath: join(root, "sessions", "session-1.jsonl"),
		} as unknown as BridgeSession;
		prompt = vi.fn();
		setBridgeForTests({
			getSession: vi.fn(() => session),
			resumeSessionById: vi.fn(),
			prompt,
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);
	});

	afterEach(async () => {
		resetBridgeForTests();
		await rm(root, { recursive: true, force: true });
	});

	it("rejects duplicate attachment IDs before prompt execution", async () => {
		const attachmentId = crypto.randomUUID();
		const response = await handleChatPost(
			new Request("http://localhost/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sessionId: session.sessionId,
					message: "Review these files",
					attachments: [
						{ kind: "upload", attachmentId, name: "one.txt", mimeType: "text/plain", size: 0 },
						{ kind: "upload", attachmentId, name: "one.txt", mimeType: "text/plain", size: 0 },
					],
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect(prompt).not.toHaveBeenCalled();
	});

	it("enforces stored aggregate size before reading bytes or prompting", async () => {
		const attachmentRoot = join(root, "session-attachments", session.sessionId);
		await mkdir(attachmentRoot, { recursive: true });
		const size = 25 * 1024 * 1024;
		const attachments = await Promise.all(
			Array.from({ length: 5 }, async (_, index) => {
				const attachmentId = crypto.randomUUID();
				const dataFile = `${attachmentId}.bin`;
				const dataPath = join(attachmentRoot, dataFile);
				await writeFile(dataPath, "");
				await truncate(dataPath, size);
				await writeFile(
					join(attachmentRoot, `${attachmentId}.json`),
					JSON.stringify({
						kind: "upload",
						attachmentId,
						name: `file-${index}.bin`,
						mimeType: "application/octet-stream",
						size,
						dataFile,
					}),
				);
				return {
					kind: "upload" as const,
					attachmentId,
					name: `file-${index}.bin`,
					mimeType: "application/octet-stream",
					size: 0,
				};
			}),
		);

		const response = await handleChatPost(
			new Request("http://localhost/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: session.sessionId, message: "Review these files", attachments }),
			}),
		);

		expect(response.status).toBe(413);
		expect(prompt).not.toHaveBeenCalled();
	});

	it("closes a session-command stream with a visible refinement result", async () => {
		const presentation = {
			revision: 1,
			userBash: [],
			rlmChildren: [],
			refinements: [
				{
					id: "refinement-1",
					summary: "Applied a refinement",
					rationale: "Keep the harness useful",
					expectedOutcome: "Better future turns",
					edits: [
						{
							action: "update" as const,
							kind: "memory",
							id: "memory-1",
							applied: true,
						},
					],
					status: "success" as const,
					timestamp: Date.now(),
				},
			],
			artifactRuns: [],
		};
		const streamSession = {
			...session,
			mapperState: {
				inRun: false,
				currentMessageId: undefined,
				runId: "",
				presentation: { revision: 0, userBash: [], rlmChildren: [], refinements: [], artifactRuns: [] },
			},
			isStreaming: false,
		} as unknown as BridgeSession;
		let listener: ((sessionId: string, frame: unknown) => void) | undefined;
		setBridgeForTests({
			getSession: vi.fn(() => streamSession),
			addEventListener: vi.fn((next) => {
				listener = next;
				return () => undefined;
			}),
			getPresentation: vi.fn(() => presentation),
			prompt: vi.fn(async () => undefined),
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);

		const response = await handleChatPost(
			new Request("http://localhost/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: streamSession.sessionId, message: "/refine" }),
			}),
		);

		const frames = (await response.text())
			.trim()
			.split("\n")
			.map(
				(line) =>
					JSON.parse(line) as {
						type: string;
						requestKind?: string;
						message?: { parts: Array<{ text?: string }> };
					},
			);
		expect(frames.map((frame) => frame.type)).toEqual(["start", "done"]);
		expect(frames[0]?.requestKind).toBe("session-command");
		expect(frames[1]?.message?.parts[0]?.text).toBe(
			sessionCommandResultText({ name: "refine", args: "", text: "/refine" }, presentation, 0),
		);
		expect(listener).toBeDefined();
	});

	it("keeps a queued session-command response scoped away from the active turn", async () => {
		const streamSession = {
			...session,
			mapperState: {
				inRun: true,
				currentMessageId: "active-run-a0",
				runId: "active-run",
				presentation: { revision: 0, userBash: [], rlmChildren: [], refinements: [], artifactRuns: [] },
			},
			isStreaming: true,
		} as unknown as BridgeSession;
		let listener: ((sessionId: string, frame: unknown) => void) | undefined;
		let finishPrompt!: () => void;
		prompt = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishPrompt = resolve;
				}),
		);
		setBridgeForTests({
			getSession: vi.fn(() => streamSession),
			addEventListener: vi.fn((next) => {
				listener = next;
				return () => undefined;
			}),
			getPresentation: vi.fn(() => streamSession.mapperState.presentation),
			prompt,
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);

		const response = await handleChatPost(
			new Request("http://localhost/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: streamSession.sessionId, message: "/refine" }),
			}),
		);
		expect(listener).toBeDefined();
		listener?.(streamSession.sessionId, {
			type: "done",
			runId: "active-run",
			sessionId: streamSession.sessionId,
			message: {
				id: "active-result",
				role: "assistant",
				parts: [{ type: "text", text: "active turn result" }],
			},
		});
		finishPrompt();

		const frames = (await response.text())
			.trim()
			.split("\n")
			.map(
				(line) =>
					JSON.parse(line) as {
						type: string;
						requestKind?: string;
						message?: { parts: Array<{ text?: string }> };
					},
			);
		expect(frames.map((frame) => frame.type)).toEqual(["start", "done"]);
		expect(frames[0]?.requestKind).toBe("session-command");
		expect(frames[1]?.requestKind).toBe("session-command");
		expect(JSON.stringify(frames)).not.toContain("active turn result");
	});
});

describe("handleChatNewPost", () => {
	it("re-applies thinking level from model payload after setModel", async () => {
		const setThinkingLevel = vi.fn();
		const setModel = vi.fn();
		const session = {
			sessionId: "session-new",
			connection: { setThinkingLevel },
		} as unknown as BridgeSession;

		setBridgeForTests({
			ensureKernelReady: vi.fn(async () => {}),
			createSession: vi.fn(async () => session),
			setModel,
			getPresentation: vi.fn(() => ({
				revision: 0,
				userBash: [],
				rlmChildren: [],
				refinements: [],
				artifactRuns: [],
			})),
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);

		const response = await handleChatNewPost(
			new Request("http://localhost/api/chat/new", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: {
						provider: "anthropic",
						id: "claude-sonnet-4-5",
						thinkingLevel: "high",
					},
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(setModel).toHaveBeenCalledWith("session-new", {
			provider: "anthropic",
			id: "claude-sonnet-4-5",
			thinkingLevel: "high",
		});
		expect(setThinkingLevel).toHaveBeenCalledWith("high");
	});
});

describe("sessionStatus", () => {
	it("identifies running, failed, idle, and interrupted sessions consistently", () => {
		const liveRunning = { isStreaming: true } as unknown as BridgeSession;
		const liveIdle = { isStreaming: false } as unknown as BridgeSession;

		expect(sessionStatus({ state: { status: "active" } }, liveRunning)).toBe("running");
		expect(sessionStatus({ state: { status: "active" } }, liveIdle)).toBe("idle");
		expect(sessionStatus({ state: { status: "crash" } }, undefined)).toBe("failed");
		expect(sessionStatus({ state: { status: "active" } }, undefined)).toBe("interrupted");
	});
});
