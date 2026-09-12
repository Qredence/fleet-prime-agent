import type {
	ChatSessionResponse,
	ChatStreamEvent,
	PrimeAgentRlmChild,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatClient } from "./chat-client";
import { ChatRequestError } from "./chat-fetch";
import { useSubagentChat } from "./use-subagent-chat";

const presentation: PrimeAgentSessionPresentation = {
	revision: 0,
	userBash: [],
	rlmChildren: [],
	refinements: [],
	artifactRuns: [],
};

function message(id: string, text: string): ChatMessage {
	return { id, role: "assistant", parts: [{ type: "text", text }] };
}

function response(messages: Array<ChatMessage> = []): ChatSessionResponse {
	return {
		session: { sessionId: "child-runtime" },
		messages,
		planPresentations: [],
		presentation,
	};
}

type TestEventSource = {
	close: ReturnType<typeof vi.fn>;
	onerror: (() => void) | null;
	onmessage: ((event: MessageEvent<string>) => void) | null;
	emit: (event: ChatStreamEvent | { type: "connected"; sessionId: string; streamGeneration: string }) => void;
};

function installEventSource() {
	const instances: Array<TestEventSource> = [];
	class EventSourceStub {
		onerror: (() => void) | null = null;
		onmessage: ((event: MessageEvent<string>) => void) | null = null;
		readonly close = vi.fn();

		constructor(_url: string) {
			instances.push(this);
		}

		emit(event: ChatStreamEvent | { type: "connected"; sessionId: string; streamGeneration: string }) {
			this.onmessage?.({
				data: JSON.stringify(event),
				lastEventId: "",
			} as MessageEvent<string>);
		}
	}
	vi.stubGlobal("EventSource", EventSourceStub);
	return instances;
}

function createHarness(loadSession: (parentSessionId: string, childId: string) => Promise<ChatSessionResponse>) {
	const openSubagentEvents = vi.fn(() => "/api/chat/events?parentSessionId=parent&childId=child-1");
	const client = { openSubagentEvents } as unknown as ChatClient;
	const child: PrimeAgentRlmChild = {
		id: "child-1",
		label: "Research worker",
		status: "running",
		timestamp: 1,
	};
	const hook = renderHook(() =>
		useSubagentChat({
			client,
			enabled: true,
			child,
			loadSession,
			parentSessionId: "parent",
		}),
	);
	return { ...hook, child, client, openSubagentEvents };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("useSubagentChat lifecycle", () => {
	it("retains a terminal snapshot and does not reconnect after completion", async () => {
		const sources = installEventSource();
		const loadSession = vi.fn(async () => response());
		const { result } = createHarness(loadSession);

		await waitFor(() => expect(sources).toHaveLength(1));
		const source = sources[0]!;
		act(() => {
			source.emit({ type: "connected", sessionId: "child-runtime", streamGeneration: "generation-1" });
			source.emit({
				type: "session_snapshot",
				session: { sessionId: "child-runtime" },
				messages: [message("completed", "Completed answer")],
				presentation,
				status: "ready",
				terminal: true,
			});
		});

		await waitFor(() => expect(result.current.messages).toEqual([message("completed", "Completed answer")]));
		expect(result.current.status).toBe("ready");
		expect(source.close).toHaveBeenCalled();
		const loadsAfterTerminal = loadSession.mock.calls.length;
		act(() => source.onerror?.());
		await Promise.resolve();
		expect(loadSession).toHaveBeenCalledTimes(loadsAfterTerminal);
	});

	it("stops retrying unknown children while preserving the last loaded messages", async () => {
		const sources = installEventSource();
		const loadSession = vi
			.fn<() => Promise<ChatSessionResponse>>()
			.mockResolvedValueOnce(response([message("known", "Last known answer")]))
			.mockRejectedValue(new ChatRequestError(404, '{"message":"Unknown live subagent stream"}'));
		const { result } = createHarness(loadSession);

		await waitFor(() => expect(sources).toHaveLength(1));
		const source = sources[0]!;
		act(() => source.onerror?.());
		await waitFor(() => expect(result.current.status).toBe("error"));
		expect(result.current.messages).toEqual([message("known", "Last known answer")]);
		expect(result.current.error?.message).toContain("Unknown live subagent stream");
		const loadsAfterUnknown = loadSession.mock.calls.length;
		act(() => source.onerror?.());
		await Promise.resolve();
		expect(loadSession).toHaveBeenCalledTimes(loadsAfterUnknown);
	});
});

describe("useSubagentChat sendMessage", () => {
	function createSendHarness(
		initial: Array<ChatMessage> = [message("user-1", "go deeper"), message("done-1", "PASS")],
	) {
		const openSubagentEvents = vi.fn(() => "/api/chat/events?parentSessionId=parent&childId=child-1");
		const streamMessage = vi.fn(async (_request: unknown, _onEvent?: unknown, _signal?: unknown) => undefined);
		const abortSession = vi.fn(async () => undefined);
		const client = { openSubagentEvents, streamMessage, abortSession } as unknown as ChatClient;
		const child: PrimeAgentRlmChild = {
			id: "child-1",
			label: "Research worker",
			status: "done",
			timestamp: 1,
		};
		const loadSession = vi.fn(async () => response(initial));
		const hook = renderHook(
			({ selectedChild }: { selectedChild: PrimeAgentRlmChild }) =>
				useSubagentChat({ client, enabled: true, child: selectedChild, loadSession, parentSessionId: "parent" }),
			{ initialProps: { selectedChild: child } },
		);
		return { ...hook, child, client, streamMessage, abortSession, loadSession };
	}

	it("posts to the child route and reconciles the canonical transcript", async () => {
		installEventSource();
		const { result, streamMessage, loadSession } = createSendHarness();

		await act(async () => {
			await result.current.sendMessage("go deeper");
		});

		expect(streamMessage).toHaveBeenCalledOnce();
		const [request] = streamMessage.mock.calls[0]!;
		expect(request).toMatchObject({
			sessionId: "parent",
			childId: "child-1",
			message: "go deeper",
			streamingBehavior: "steer",
		});
		await waitFor(() => expect(loadSession).toHaveBeenCalledTimes(2));
		expect(result.current.status).toBe("ready");
		expect(result.current.messages).toEqual([message("user-1", "go deeper"), message("done-1", "PASS")]);
	});

	it("surfaces stream errors and drops the optimistic message", async () => {
		installEventSource();
		const { result, streamMessage } = createSendHarness([]);
		streamMessage.mockRejectedValueOnce(new Error("boom"));

		await act(async () => {
			await result.current.sendMessage("go deeper");
		});

		expect(result.current.status).toBe("error");
		expect(result.current.error?.message).toBe("boom");
		expect(result.current.messages).toEqual([]);
	});

	it("stops an in-flight send via the abort route", async () => {
		installEventSource();
		const { result, abortSession } = createSendHarness();

		act(() => {
			result.current.stop();
		});

		expect(abortSession).toHaveBeenCalledWith({ sessionId: "parent", childId: "child-1" });
	});

	it("stops the child whose send remains in flight after selection changes", async () => {
		installEventSource();
		const { result, rerender, child, streamMessage, abortSession } = createSendHarness();
		let sendSignal: AbortSignal | undefined;
		streamMessage.mockImplementationOnce(async (_request, _onEvent, signal) => {
			const activeSignal = signal as AbortSignal;
			sendSignal = activeSignal;
			await new Promise<void>((resolve) => activeSignal.addEventListener("abort", () => resolve(), { once: true }));
		});

		let pendingSend: Promise<void> | undefined;
		act(() => {
			pendingSend = result.current.sendMessage("go deeper");
		});
		await waitFor(() => expect(streamMessage).toHaveBeenCalledOnce());

		rerender({ selectedChild: { ...child, id: "child-2", label: "Second worker" } });
		act(() => result.current.stop());

		expect(sendSignal?.aborted).toBe(true);
		expect(abortSession).toHaveBeenCalledWith({ sessionId: "parent", childId: "child-1" });
		await act(async () => pendingSend);
	});
});
