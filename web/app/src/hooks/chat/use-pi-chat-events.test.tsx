import type { PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatClient } from "@/lib/chat/chat-client";
import { EMPTY_SESSION_PRESENTATION } from "@/lib/chat/chat-stream-state";
import { createChatStoreFixture } from "@/test/chat-store-fixture";
import { usePiChatSessionEvents } from "@/hooks/chat/use-pi-chat-stream";

type Stub = {
	readonly url: string;
	close: ReturnType<typeof vi.fn>;
	onerror: (() => void) | null;
	onmessage: ((event: MessageEvent<string>) => void) | null;
};

/** Install an EventSource double and return the list it records instances into. */
function stubEventSource(): Array<Stub> {
	const instances: Array<Stub> = [];
	class EventSourceStub {
		readonly url: string;
		readonly close = vi.fn();
		onerror: (() => void) | null = null;
		onmessage: ((event: MessageEvent<string>) => void) | null = null;
		constructor(url: string) {
			this.url = url;
			instances.push(this);
		}
	}
	vi.stubGlobal("EventSource", EventSourceStub);
	return instances;
}

function sendTo(stub: Stub, frame: unknown, lastEventId = "") {
	stub.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame), lastEventId }));
}

describe("usePiChatSessionEvents", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("keeps the active reply across a nonterminal session reset", async () => {
		const sources = stubEventSource();
		const { store, get } = createChatStoreFixture({ sessionMetadata: { sessionId: "reset-session" } });
		const { unmount } = renderHook(() =>
			usePiChatSessionEvents({ client: {} as ChatClient, sessionId: "reset-session", store }),
		);
		const source = sources[0]!;
		await act(async () => {
			sendTo(source, { type: "start", id: "reply", runId: "run", sessionId: "reset-session" });
			sendTo(source, { type: "delta", text: "before " });
			sendTo(source, {
				type: "done",
				runId: "run",
				sessionId: "reset-session",
				sessionReset: true,
				message: { id: "reset", role: "assistant", parts: [] },
			});
			sendTo(source, { type: "delta", text: "after" });
		});
		expect(get().messages).toHaveLength(1);
		expect(get().messages[0]).toMatchObject({ id: "reply", parts: [{ type: "text", text: "before after" }] });
		unmount();
	});

	it("merges question updates into the active assistant bubble", async () => {
		const sources = stubEventSource();
		const { store, get } = createChatStoreFixture({
			messages: [{ id: "active-assistant", role: "assistant", parts: [{ type: "text", text: "" }] }],
			sessionMetadata: { sessionId: "session-a" },
			status: "streaming",
		});
		renderHook(() => usePiChatSessionEvents({ client: {} as ChatClient, sessionId: "session-a", store }));
		const source = sources[0]!;
		await act(async () => {
			sendTo(source, {
				type: "tool",
				part: {
					type: "tool-Question",
					toolCallId: "question-1",
					state: "input-streaming",
					input: { title: "Choose" },
				},
			});
		});
		expect(get().messages).toHaveLength(1);
		expect(get().messages[0]?.parts).toContainEqual(
			expect.objectContaining({ toolCallId: "question-1", state: "input-streaming" }),
		);

		const duplicate: ChatMessage = {
			id: "duplicate-question",
			role: "assistant",
			parts: [{ type: "tool-Question", toolCallId: "question-1", state: "input-streaming" }],
		};
		store.patch((current) => ({ messages: [duplicate, ...current.messages] }));

		await act(async () => {
			sendTo(source, {
				type: "tool",
				part: {
					type: "tool-Question",
					toolCallId: "question-1",
					state: "output-available",
					output: { choice: "yes" },
				},
			});
		});
		expect(get().messages).toHaveLength(1);
		expect(get().messages[0]?.id).toBe("active-assistant");
		expect(get().messages[0]?.parts).toContainEqual(
			expect.objectContaining({ toolCallId: "question-1", state: "output-available" }),
		);
	});

	it("applies ordered replay once and stops at gaps or malformed frames", async () => {
		const sources = stubEventSource();
		const applyEvent = vi.fn();
		const recoveryRef = {
			current: {
				active: true,
				sessionId: "session-recovery",
				cursor: { generation: "gen-1", sequence: 4 },
				needsSnapshot: false,
				applyEvent,
			},
		};
		const { store } = createChatStoreFixture({
			sessionMetadata: { sessionId: "session-recovery" },
			status: "streaming",
		});
		renderHook(() =>
			usePiChatSessionEvents({
				client: {} as ChatClient,
				recoveryRef,
				sessionId: "session-recovery",
				store,
			}),
		);
		const source = sources[0]!;
		const send = (sequence: number, text = "replayed") =>
			sendTo(source, { type: "delta", text, eventCursor: { generation: "gen-1", sequence } }, String(sequence));
		await act(async () => {
			sendTo(
				source,
				{
					type: "reasoning_text",
					phase: "delta",
					text: "invalid index",
					eventCursor: { generation: "gen-1", sequence: 5 },
				},
				"5",
			);
			send(6);
			send(6);
		});
		expect(applyEvent).toHaveBeenCalledOnce();
		expect(recoveryRef.current.cursor).toEqual({ generation: "gen-1", sequence: 6 });
		await act(async () => send(8));
		expect(applyEvent).toHaveBeenCalledOnce();
		expect(recoveryRef.current.needsSnapshot).toBe(true);
	});

	it("ignores an agent-settled hydration that resolves after the visible session changes", async () => {
		let resolveSession!: (value: {
			messages: [];
			presentation: PrimeAgentSessionPresentation;
			session: { sessionId: string };
		}) => void;
		const loadSession = vi.fn(
			() =>
				new Promise<{ messages: []; presentation: PrimeAgentSessionPresentation; session: { sessionId: string } }>(
					(resolve) => {
						resolveSession = resolve;
					},
				),
		);
		const sources = stubEventSource();
		const { store, changes } = createChatStoreFixture({ sessionMetadata: { sessionId: "session-a" } });
		renderHook(() =>
			usePiChatSessionEvents({
				client: { loadSession } as unknown as ChatClient,
				sessionId: "session-a",
				store,
			}),
		);

		await act(async () => {
			sendTo(sources[0]!, { type: "state", state: { name: "agent_settled" } });
		});
		store.patch({ sessionMetadata: { sessionId: "session-b" } });
		changes.length = 0;
		await act(async () => {
			resolveSession({
				messages: [],
				presentation: EMPTY_SESSION_PRESENTATION,
				session: { sessionId: "session-a" },
			});
			await Promise.resolve();
		});

		expect(changes).toEqual([]);
	});

	it("ignores an agent-settled hydration that resolves after effect teardown", async () => {
		let resolveSession!: (value: {
			messages: [];
			presentation: PrimeAgentSessionPresentation;
			session: { sessionId: string };
		}) => void;
		const loadSession = vi.fn(
			() =>
				new Promise<{ messages: []; presentation: PrimeAgentSessionPresentation; session: { sessionId: string } }>(
					(resolve) => {
						resolveSession = resolve;
					},
				),
		);
		const sources = stubEventSource();
		const { store, changes } = createChatStoreFixture({ sessionMetadata: { sessionId: "session-a" } });
		const { unmount } = renderHook(() =>
			usePiChatSessionEvents({
				client: { loadSession } as unknown as ChatClient,
				sessionId: "session-a",
				store,
			}),
		);

		await act(async () => {
			sendTo(sources[0]!, { type: "state", state: { name: "agent_settled" } });
		});
		unmount();
		changes.length = 0;
		await act(async () => {
			resolveSession({
				messages: [],
				presentation: EMPTY_SESSION_PRESENTATION,
				session: { sessionId: "session-a" },
			});
			await Promise.resolve();
		});

		expect(changes).toEqual([]);
	});

	it("ignores queued frames from a closed session stream after a session switch", async () => {
		const sources = stubEventSource();
		const { store, changes } = createChatStoreFixture({ sessionMetadata: { sessionId: "session-a" } });
		const { rerender } = renderHook(
			({ sessionId }) => usePiChatSessionEvents({ client: {} as ChatClient, sessionId, store }),
			{ initialProps: { sessionId: "session-a" } },
		);

		const staleSource = sources[0]!;
		rerender({ sessionId: "session-b" });
		store.patch({ sessionMetadata: { sessionId: "session-b" } });
		changes.length = 0;
		await act(async () => {
			sendTo(staleSource, { type: "state", state: { message: "stale state" } });
		});

		expect(staleSource.close).toHaveBeenCalledOnce();
		expect(changes).toEqual([]);
	});

	it("ignores a queued frame from a stream superseded by reconnect", async () => {
		vi.useFakeTimers();
		const sources = stubEventSource();
		const { store, changes } = createChatStoreFixture({ sessionMetadata: { sessionId: "session-a" } });
		renderHook(() => usePiChatSessionEvents({ client: {} as ChatClient, sessionId: "session-a", store }));

		const staleSource = sources[0]!;
		await act(async () => {
			staleSource.onerror?.();
			await vi.advanceTimersByTimeAsync(2_000);
		});
		changes.length = 0;
		await act(async () => {
			sendTo(staleSource, { type: "state", state: { message: "stale state" } });
		});

		expect(sources).toHaveLength(2);
		expect(changes).toEqual([]);
	});

	it("retries failed snapshots without advancing the durable cursor", async () => {
		vi.useFakeTimers();
		const sources = stubEventSource();
		const key = "pi:sse:last-event-id:resync-test";
		window.sessionStorage.removeItem(key);
		let resolveLoad!: (value: unknown) => void;
		const loadSession = vi
			.fn()
			.mockRejectedValueOnce(new Error("temporary"))
			.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveLoad = resolve;
					}),
			);
		// A non-empty transcript makes the resync observable: the reloaded snapshot
		// is empty, so clearing proves the canonical snapshot was applied.
		const { store, get } = createChatStoreFixture({
			messages: [{ id: "stale", role: "assistant", parts: [{ type: "text", text: "stale" }] }],
			sessionMetadata: { sessionId: "resync-test" },
		});
		const { unmount } = renderHook(() =>
			usePiChatSessionEvents({
				client: { loadSession } as unknown as ChatClient,
				sessionId: "resync-test",
				store,
			}),
		);
		const send = (data: unknown, sequence = "") => sendTo(sources[0]!, data, sequence);
		await act(async () => {
			send({ type: "connected", streamGeneration: "g" });
			send({ type: "queue", steering: [], followUp: [] }, "4");
			send({ type: "state", state: { name: "agent_settled", message: "resync-required" } }, "10");
		});
		expect(JSON.parse(window.sessionStorage.getItem(key)!).lastEventId).toBe(4);
		await act(async () => {
			send({ type: "queue", steering: [], followUp: [] }, "11");
			await vi.advanceTimersByTimeAsync(2_000);
		});
		expect(loadSession).toHaveBeenCalledTimes(2);
		expect(JSON.parse(window.sessionStorage.getItem(key)!).lastEventId).toBe(4);
		await act(async () => {
			resolveLoad({
				session: { sessionId: "resync-test" },
				messages: [],
				planPresentations: [],
				presentation: EMPTY_SESSION_PRESENTATION,
			});
		});
		expect(JSON.parse(window.sessionStorage.getItem(key)!).lastEventId).toBe(10);
		expect(get().messages).toEqual([]);
		unmount();
	});

	it("persists streamGeneration with lastEventId and resets the stored cursor on cursorReset", async () => {
		vi.useFakeTimers();
		const sources = stubEventSource();
		window.sessionStorage.removeItem("pi:sse:last-event-id:session-gen");

		const loadSession = vi.fn(async () => ({
			messages: [],
			presentation: EMPTY_SESSION_PRESENTATION,
			session: { sessionId: "session-gen" },
		}));
		const { store, changes } = createChatStoreFixture({ sessionMetadata: { sessionId: "session-gen" } });
		renderHook(() =>
			usePiChatSessionEvents({
				client: { loadSession } as unknown as ChatClient,
				sessionId: "session-gen",
				store,
			}),
		);

		const first = sources[0]!;
		await act(async () => {
			sendTo(first, { type: "connected", sessionId: "session-gen", streamGeneration: "gen-1" });
			sendTo(first, { type: "queue", steering: ["hi"], followUp: [] }, "14");
		});

		expect(window.sessionStorage.getItem("pi:sse:last-event-id:session-gen")).toBe(
			JSON.stringify({ generation: "gen-1", lastEventId: 14 }),
		);

		await act(async () => {
			first.onerror?.();
			await vi.advanceTimersByTimeAsync(2_000);
		});

		const second = sources[1]!;
		expect(second.url).toContain("streamGeneration=gen-1");
		expect(second.url).toContain("lastEventId=14");

		await act(async () => {
			sendTo(second, {
				type: "connected",
				sessionId: "session-gen",
				streamGeneration: "gen-2",
				cursorReset: true,
			});
			sendTo(second, { type: "state", state: { name: "agent_settled", message: "resync-required" } });
		});

		expect(window.sessionStorage.getItem("pi:sse:last-event-id:session-gen")).toBe(
			JSON.stringify({ generation: "gen-2", lastEventId: 0 }),
		);
		expect(changes.map((change) => change.activityLabel)).not.toContain("resync-required");
		expect(loadSession).toHaveBeenCalledWith({ sessionId: "session-gen" });
	});
});
