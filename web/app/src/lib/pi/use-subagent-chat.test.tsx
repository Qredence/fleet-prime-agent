import { act, renderHook, waitFor } from "@testing-library/react";
import type {
	ChatSessionResponse,
	ChatStreamEvent,
	PrimeAgentRlmChild,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
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
			this.onmessage?.(
				{
					data: JSON.stringify(event),
					lastEventId: "",
				} as MessageEvent<string>,
			);
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
