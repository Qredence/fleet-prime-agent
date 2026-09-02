import { act, renderHook, waitFor } from "@testing-library/react";
import type {
	ChatRequest,
	ChatSessionInfo,
	ChatSessionMetadata,
	ChatSessionResponse,
	ChatStreamEvent,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatClient } from "./chat-client";
import { toChatMessage } from "./chat-message-helpers";
import { usePiChat } from "./use-pi-chat";

const presentation: PrimeAgentSessionPresentation = {
	revision: 0,
	userBash: [],
	rlmChildren: [],
	refinements: [],
	artifactRuns: [],
};

type StreamCall = {
	onEvent: (event: ChatStreamEvent) => void;
	reject: (reason?: unknown) => void;
	request: ChatRequest;
	resolve: () => void;
};

function sessionResponse(session: ChatSessionMetadata): ChatSessionResponse {
	return {
		session,
		messages: [],
		planPresentations: [],
		presentation,
	};
}

function startEvent(sessionId: string, requestKind?: "session-command"): ChatStreamEvent {
	return {
		type: "start",
		id: `${sessionId}-assistant`,
		runId: `${sessionId}-run`,
		sessionId,
		requestKind,
	};
}

function queueEvent(): ChatStreamEvent {
	return { type: "queue", steering: ["queued"], followUp: [] };
}

function sessionCommandDoneEvent(sessionId: string): ChatStreamEvent {
	return {
		type: "done",
		runId: `${sessionId}-command-run`,
		sessionId,
		requestKind: "session-command",
		message: toChatMessage(`${sessionId}-command-result`, "assistant", [
			{ type: "text", text: "Session command completed" },
		]),
	};
}

function sessionResetDoneEvent(sessionId: string): ChatStreamEvent {
	return {
		type: "done",
		runId: `${sessionId}-reset-run`,
		sessionId,
		sessionReset: true,
		message: toChatMessage(`${sessionId}-reset-message`, "assistant", []),
	};
}

function completedSessionResponse(sessionId: string): ChatSessionResponse {
	return {
		session: { sessionId },
		messages: [
			toChatMessage("persisted-user", "user", [{ type: "text", text: "primary" }]),
			toChatMessage("persisted-assistant", "assistant", [{ type: "text", text: "completed answer" }]),
		],
		planPresentations: [],
		presentation,
	};
}

async function flush() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

function createHarness(sessionId = "session-a", availableSessions: Array<ChatSessionInfo> = []) {
	const discoveredSessions =
		availableSessions.length > 0
			? availableSessions
			: [
					{
						sessionId,
						title: "Test session",
						createdAt: "2026-08-27T00:00:00.000Z",
						updatedAt: "2026-08-27T00:00:00.000Z",
						status: "idle" as const,
						messageCount: 0,
						firstMessage: "Test session",
					},
				];
	const eventSources: TestEventSource[] = [];
	class TestEventSource {
		onerror: (() => void) | null = null;
		onmessage: ((event: MessageEvent<string>) => void) | null = null;
		readonly close = vi.fn();

		constructor(_url: string) {
			eventSources.push(this);
		}
	}
	vi.stubGlobal("EventSource", TestEventSource);

	const streams: Array<StreamCall> = [];
	const persistSession = vi.fn();
	const loadSession = vi.fn().mockImplementation(async (metadata: ChatSessionMetadata) => sessionResponse(metadata));
	const deleteQueuedMessage = vi.fn().mockResolvedValue({
		status: "applied",
		queue: { steering: [], followUp: [] },
	});
	const client = {
		abortSession: vi.fn().mockResolvedValue(undefined),
		deleteQueuedMessage,
		listSessions: vi.fn().mockResolvedValue(discoveredSessions),
		loadSession,
		resumeSession: vi.fn().mockImplementation(async (metadata: ChatSessionMetadata) => sessionResponse(metadata)),
		streamMessage: vi.fn(
			(
				request: ChatRequest,
				onEvent: (event: ChatStreamEvent) => void,
				signal?: AbortSignal,
			) =>
				new Promise<void>((resolve, reject) => {
					const call: StreamCall = { onEvent, reject, request, resolve };
					streams.push(call);
					if (signal?.aborted) {
						reject(new DOMException("Aborted", "AbortError"));
						return;
					}
					signal?.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					);
				}),
		),
	} as unknown as ChatClient;

	const hook = renderHook(() =>
		usePiChat(undefined, {
			client,
			initialSessionMetadata: { sessionId },
			persistSession,
		}),
	);

	return { client, ...hook, eventSources, loadSession, streams };
}

describe("usePiChat stream admission", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("binds queued submissions to their originating session and releases the next post on queue admission", async () => {
		const { result, streams } = createHarness();
		await act(async () => flush());

		let primary!: Promise<void>;
		await act(async () => {
			primary = result.current.sendMessage({ text: "primary" });
			await flush();
		});
		expect(streams).toHaveLength(1);

		await act(async () => {
			streams[0].onEvent(startEvent("session-a"));
			await flush();
		});

		let firstQueued!: Promise<void>;
		await act(async () => {
			firstQueued = result.current.sendMessage({ text: "first queued" });
			await flush();
		});
		expect(streams).toHaveLength(2);

		let secondQueued!: Promise<void>;
		await act(async () => {
			secondQueued = result.current.sendMessage({ text: "second queued" });
			await flush();
		});
		await act(async () => {
			await result.current.resumeSession({ sessionId: "session-b" }, { preserveRunning: true });
		});

		await act(async () => {
			streams[1].onEvent(queueEvent());
			await flush();
		});

		expect(streams).toHaveLength(3);
		expect(streams[2].request).toMatchObject({ message: "second queued", sessionId: "session-a" });

		streams[1].resolve();
		streams[2].resolve();
		streams[0].resolve();
		await act(async () => {
			await Promise.all([primary, firstQueued, secondQueued]);
		});
	});

	it("removes a queued message optimistically and reconciles the server queue", async () => {
		const { client, eventSources, result } = createHarness();
		await act(async () => flush());

		await act(async () => {
			eventSources[0]?.onmessage?.(
				new MessageEvent("message", { data: JSON.stringify({ type: "queue", steering: ["queued"], followUp: [] }) }),
			);
			await flush();
		});
		await act(async () => {
			await result.current.deleteQueuedMessage("steering", 0, "queued");
		});

		expect(client.deleteQueuedMessage).toHaveBeenCalledWith({
			sessionId: "session-a",
			lane: "steering",
			index: 0,
			expectedText: "queued",
		});
		expect(result.current.queue).toEqual({ steering: [], followUp: [] });
	});

	it("serializes queued-message deletes and re-resolves shifted indices", async () => {
		const { client, eventSources, result } = createHarness();
		await act(async () => flush());

		await act(async () => {
			eventSources[0]?.onmessage?.(
				new MessageEvent("message", {
					data: JSON.stringify({ type: "queue", steering: ["first", "second"], followUp: [] }),
				}),
			);
			await flush();
		});

		const firstResponse = deferred<{
			status: "applied" | "rejected" | "invalid" | "unsupported";
			queue: { steering: string[]; followUp: string[] };
		}>();
		const secondResponse = deferred<{
			status: "applied" | "rejected" | "invalid" | "unsupported";
			queue: { steering: string[]; followUp: string[] };
		}>();
		vi.mocked(client.deleteQueuedMessage)
			.mockReturnValueOnce(firstResponse.promise)
			.mockReturnValueOnce(secondResponse.promise);

		let firstDeletion!: Promise<boolean>;
		await act(async () => {
			firstDeletion = result.current.deleteQueuedMessage("steering", 0, "first");
			await flush();
		});
		let secondDeletion!: Promise<boolean>;
		await act(async () => {
			secondDeletion = result.current.deleteQueuedMessage("steering", 1, "second");
			await flush();
		});

		expect(client.deleteQueuedMessage).toHaveBeenCalledTimes(1);
		firstResponse.resolve({ status: "applied", queue: { steering: ["second"], followUp: [] } });
		await waitFor(() => expect(client.deleteQueuedMessage).toHaveBeenCalledTimes(2));
		expect(client.deleteQueuedMessage).toHaveBeenNthCalledWith(2, {
			sessionId: "session-a",
			lane: "steering",
			index: 0,
			expectedText: "second",
		});

		secondResponse.resolve({ status: "applied", queue: { steering: [], followUp: [] } });
		await act(async () => {
			await Promise.all([firstDeletion, secondDeletion]);
		});
		expect(result.current.queue).toEqual({ steering: [], followUp: [] });
	});

	it("ignores a queued-message response after switching sessions", async () => {
		const { client, eventSources, result } = createHarness();
		await act(async () => flush());

		await act(async () => {
			eventSources[0]?.onmessage?.(
				new MessageEvent("message", { data: JSON.stringify({ type: "queue", steering: ["queued"], followUp: [] }) }),
			);
			await flush();
		});

		const response = deferred<{
			status: "applied" | "rejected" | "invalid" | "unsupported";
			queue: { steering: string[]; followUp: string[] };
		}>();
		vi.mocked(client.deleteQueuedMessage).mockReturnValueOnce(response.promise);
		let deletion!: Promise<boolean>;
		await act(async () => {
			deletion = result.current.deleteQueuedMessage("steering", 0, "queued");
			await flush();
		});

		await act(async () => {
			await result.current.resumeSession({ sessionId: "session-b" });
		});
		response.resolve({ status: "applied", queue: { steering: ["stale"], followUp: [] } });
		await act(async () => {
			await deletion;
		});

		expect(result.current.sessionMetadata.sessionId).toBe("session-b");
		expect(result.current.queue).toEqual({ steering: [], followUp: [] });
	});

	it("sends the artifact prompt flag once while ordinary chat remains unflagged", async () => {
		const { result, streams } = createHarness();
		await act(async () => flush());

		let artifactTurn!: Promise<void>;
		await act(async () => {
			artifactTurn = result.current.sendMessage({
				text: "Generate an architecture visualization",
				openUI: true,
				openUIArtifact: true,
			});
			await flush();
		});
		expect(streams[0]?.request).toMatchObject({
			message: "Generate an architecture visualization",
			openUI: true,
			openUIArtifact: true,
		});
		streams[0]!.resolve();
		await act(async () => artifactTurn);

		let ordinaryTurn!: Promise<void>;
		await act(async () => {
			ordinaryTurn = result.current.sendMessage({ text: "Explain the architecture" });
			await flush();
		});
		expect(streams[1]?.request.openUI).toBeUndefined();
		expect(streams[1]?.request.openUIArtifact).toBeUndefined();
		streams[1]!.resolve();
		await act(async () => ordinaryTurn);
	});

	it("uses the newest discovered session when the stored selection is unavailable", async () => {
		const discovered: ChatSessionInfo = {
			sessionId: "newest-session",
			projectId: "project-a",
			title: "Newest session",
			createdAt: "2026-08-27T00:00:00.000Z",
			updatedAt: "2026-08-27T01:00:00.000Z",
			status: "idle",
			messageCount: 2,
			firstMessage: "Continue this work",
		};
		const { client, result } = createHarness("missing-session", [discovered]);

		await waitFor(() =>
			expect(client.loadSession).toHaveBeenCalledWith({
				sessionId: discovered.sessionId,
				projectId: discovered.projectId,
			}),
		);

		expect(result.current.sessionMetadata).toEqual({
			sessionId: discovered.sessionId,
			projectId: discovered.projectId,
		});
	});

	it("settles an admission when its stream starts after the session is hidden", async () => {
		const { result, streams } = createHarness();
		await act(async () => flush());

		let primary!: Promise<void>;
		await act(async () => {
			primary = result.current.sendMessage({ text: "primary" });
			await flush();
		});

		let queued!: Promise<void>;
		await act(async () => {
			queued = result.current.sendMessage({ text: "queued while waiting" });
			await flush();
		});
		expect(streams).toHaveLength(1);

		await act(async () => {
			await result.current.resumeSession({ sessionId: "session-b" }, { preserveRunning: true });
		});
		await act(async () => {
			streams[0].onEvent(startEvent("session-a"));
			await flush();
		});

		expect(streams).toHaveLength(2);
		expect(streams[1].request).toMatchObject({ message: "queued while waiting", sessionId: "session-a" });

		streams[1].resolve();
		streams[0].resolve();
		await act(async () => {
			await Promise.all([primary, queued]);
		});
	});

	it("removes a failed optimistic turn so a retry starts cleanly", async () => {
		const { result, streams } = createHarness();
		await act(async () => flush());

		let failed!: Promise<void>;
		await act(async () => {
			failed = result.current.sendMessage({ text: "will fail" });
			await flush();
		});
		expect(result.current.messages.some((message) => message.role === "user")).toBe(true);

		streams[0].reject(new Error("transport failed"));
		await act(async () => {
			await failed;
		});
		expect(result.current.messages.some((message) => message.role === "user")).toBe(false);

		let retry!: Promise<void>;
		await act(async () => {
			retry = result.current.sendMessage({ text: "retry" });
			await flush();
		});
		expect(streams).toHaveLength(2);
		expect(result.current.messages.some((message) => message.role === "user")).toBe(true);

		streams[1].resolve();
		await act(async () => {
			await retry;
		});
	});

	it("settles an idle session command without leaving its optimistic user message", async () => {
		const { result, streams } = createHarness();
		await act(async () => flush());

		let command!: Promise<void>;
		await act(async () => {
			command = result.current.sendMessage({ text: "/goal status" });
			await flush();
		});
		await act(async () => {
			streams[0].onEvent(startEvent("session-a"));
			streams[0].onEvent(sessionCommandDoneEvent("session-a"));
			await flush();
		});

		const userMessage = result.current.messages.find((message) => message.role === "user");
		expect(userMessage).toBeDefined();
		expect(userMessage).not.toHaveProperty("optimistic");

		streams[0].resolve();
		await act(async () => {
			await command;
		});
	});

	it("keeps the primary answer visible when a runtime reset arrives before completion", async () => {
		const { result, streams } = createHarness();
		await act(async () => flush());

		let turn!: Promise<void>;
		await act(async () => {
			turn = result.current.sendMessage({ text: "primary" });
			await flush();
		});
		await act(async () => {
			streams[0].onEvent(startEvent("session-a"));
			streams[0].onEvent({ type: "delta", messageId: "session-a-assistant", text: "partial" });
			streams[0].onEvent(sessionResetDoneEvent("session-a"));
			streams[0].onEvent({ type: "delta", messageId: "session-a-resumed-assistant", text: " answer" });
			streams[0].onEvent({
				type: "done",
				runId: "session-a-resumed-run",
				sessionId: "session-a",
				message: toChatMessage("session-a-resumed-assistant", "assistant", [
					{ type: "text", text: "partial answer" },
				]),
			});
			await flush();
		});

		streams[0].resolve();
		await act(async () => {
			await turn;
		});

		expect(result.current.status).toBe("ready");
		expect(result.current.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ role: "assistant", parts: [{ type: "text", text: "partial answer" }] }),
			]),
		);
	});

	it("rehydrates the persisted answer when the turn stream ends without a terminal frame", async () => {
		const { client, loadSession, result, streams } = createHarness();
		await act(async () => flush());

		loadSession.mockResolvedValue(completedSessionResponse("session-a"));
		let turn!: Promise<void>;
		await act(async () => {
			turn = result.current.sendMessage({ text: "primary" });
			await flush();
		});
		await act(async () => {
			streams[0].onEvent(startEvent("session-a"));
			streams[0].onEvent({ type: "delta", messageId: "session-a-assistant", text: "partial" });
			await flush();
		});

		streams[0].resolve();
		await act(async () => {
			await turn;
		});

		expect(loadSession).toHaveBeenLastCalledWith({ sessionId: "session-a" });
		expect(client.listSessions).toHaveBeenCalled();
		expect(result.current.status).toBe("ready");
		expect(result.current.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "persisted-assistant", parts: [{ type: "text", text: "completed answer" }] }),
			]),
		);
	});

	it("rehydrates canonical tool payloads after a terminal frame replaces the live bubble", async () => {
		const { client, loadSession, result, streams } = createHarness();
		await act(async () => flush());

		loadSession.mockResolvedValue({
			session: { sessionId: "session-a" },
			messages: [
				toChatMessage("persisted-user", "user", [{ type: "text", text: "primary" }]),
				toChatMessage("persisted-assistant", "assistant", [
					{ type: "text", text: "completed answer" },
					{
						type: "tool-IPython",
						toolCallId: "persisted-tool",
						state: "output-available",
						output: { stdout: "persisted output" },
					},
				]),
			],
			planPresentations: [],
			presentation,
		});

		let turn!: Promise<void>;
		await act(async () => {
			turn = result.current.sendMessage({ text: "primary" });
			await flush();
		});
		await act(async () => {
			streams[0].onEvent(startEvent("session-a"));
			streams[0].onEvent({ type: "delta", messageId: "session-a-assistant", text: "partial" });
			streams[0].onEvent({
				type: "done",
				runId: "session-a-run",
				sessionId: "session-a",
				message: toChatMessage("session-a-assistant", "assistant", [
					{ type: "text", text: "completed answer" },
				]),
			});
			await flush();
		});

		streams[0].resolve();
		await act(async () => {
			await turn;
		});

		expect(client.loadSession).toHaveBeenLastCalledWith({ sessionId: "session-a" });
		expect(result.current.status).toBe("ready");
		expect(result.current.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "persisted-assistant",
					parts: expect.arrayContaining([
						{ type: "text", text: "completed answer" },
						expect.objectContaining({ type: "tool-IPython", output: { stdout: "persisted output" } }),
					]),
				}),
			]),
		);
	});

	it("does not append a hidden session-command result to the newly visible session", async () => {
		const { result, streams } = createHarness();
		await act(async () => flush());

		let primary!: Promise<void>;
		await act(async () => {
			primary = result.current.sendMessage({ text: "primary" });
			await flush();
		});
		await act(async () => {
			streams[0].onEvent(startEvent("session-a"));
			await flush();
		});

		let command!: Promise<void>;
		await act(async () => {
			command = result.current.sendMessage({ text: "/goal status" });
			await flush();
		});
		expect(streams).toHaveLength(2);

		await act(async () => {
			await result.current.resumeSession({ sessionId: "session-b" }, { preserveRunning: true });
			streams[1].onEvent(sessionCommandDoneEvent("session-a"));
			await flush();
		});

		expect(result.current.messages.some((message) => message.id === "session-a-command-result")).toBe(false);

		streams[1].resolve();
		streams[0].resolve();
		await act(async () => {
			await Promise.all([primary, command]);
		});
	});

	it("releases later queued sends when a session command is admitted", async () => {
		const { result, streams } = createHarness();
		await act(async () => flush());

		let primary!: Promise<void>;
		await act(async () => {
			primary = result.current.sendMessage({ text: "primary" });
			await flush();
		});
		await act(async () => {
			streams[0].onEvent(startEvent("session-a"));
			await flush();
		});

		let command!: Promise<void>;
		await act(async () => {
			command = result.current.sendMessage({ text: "/goal status" });
			await flush();
		});
		expect(streams).toHaveLength(2);

		await act(async () => {
			streams[1].onEvent(startEvent("session-a", "session-command"));
			await flush();
		});

		let next!: Promise<void>;
		await act(async () => {
			next = result.current.sendMessage({ text: "after command" });
			await flush();
		});
		expect(streams).toHaveLength(3);
		expect(streams[2].request).toMatchObject({ message: "after command", sessionId: "session-a" });

		streams[1].resolve();
		streams[2].resolve();
		streams[0].resolve();
		await act(async () => {
			await Promise.all([primary, command, next]);
		});
	});

	it("resets admission synchronously when stopping so the next send is not blocked", async () => {
		const { client, result, streams } = createHarness();
		await act(async () => flush());

		let stopped!: Promise<void>;
		await act(async () => {
			stopped = result.current.sendMessage({ text: "stopped" });
			await flush();
		});

		await act(async () => {
			result.current.stop();
			await flush();
		});
		expect(client.abortSession).toHaveBeenCalledWith({ sessionId: "session-a" });

		let next!: Promise<void>;
		await act(async () => {
			next = result.current.sendMessage({ text: "next" });
			await flush();
		});
		expect(streams).toHaveLength(2);

		streams[1].resolve();
		await act(async () => {
			await Promise.all([stopped, next]);
		});
	});

	it("preserves a canonicalized user message when stopping an active stream", async () => {
		const { result, streams } = createHarness();
		await act(async () => flush());

		let primary!: Promise<void>;
		await act(async () => {
			primary = result.current.sendMessage({ text: "accepted prompt" });
			await flush();
		});
		await act(async () => {
			streams[0].onEvent(startEvent("session-a"));
			streams[0].onEvent({
				type: "message",
				message: toChatMessage("server-user", "user", [{ type: "text", text: "accepted prompt" }]),
			});
			await flush();
		});

		await act(async () => {
			result.current.stop();
			await flush();
		});

		expect(result.current.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ role: "user", parts: [{ type: "text", text: "accepted prompt" }] }),
			]),
		);

		await act(async () => {
			await primary;
		});
	});
});
