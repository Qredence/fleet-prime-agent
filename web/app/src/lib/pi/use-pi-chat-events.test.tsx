import type { PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatClient } from "./chat-client";
import { usePiChatSessionEvents } from "./use-pi-chat-events";

const EMPTY_PRESENTATION: PrimeAgentSessionPresentation = {
	artifactRuns: [],
	refinements: [],
	rlmChildren: [],
	revision: 0,
	userBash: [],
};

describe("usePiChatSessionEvents", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("ignores an agent-settled hydration that resolves after the visible session changes", async () => {
		let resolveSession!: (value: { messages: []; presentation: PrimeAgentSessionPresentation; session: { sessionId: string } }) => void;
		const loadSession = vi.fn(
			() =>
				new Promise<{ messages: []; presentation: PrimeAgentSessionPresentation; session: { sessionId: string } }>(
					(resolve) => {
						resolveSession = resolve;
					},
				),
		);
		class EventSourceStub {
			static instances: EventSourceStub[] = [];
			readonly close = vi.fn();
			onerror: (() => void) | null = null;
			onmessage: ((event: MessageEvent<string>) => void) | null = null;
			constructor() {
				EventSourceStub.instances.push(this);
			}
		}
		vi.stubGlobal("EventSource", EventSourceStub);

		const sessionMetadataRef = { current: { sessionId: "session-a" } };
		const setMessagesSynced = vi.fn();
		const setPresentationSynced = vi.fn();
		const setSessionMetadataSynced = vi.fn();
		renderHook(() =>
			usePiChatSessionEvents({
				client: { loadSession } as unknown as ChatClient,
				presentationRef: { current: EMPTY_PRESENTATION },
				sessionId: "session-a",
				sessionMetadataRef,
				setActivityLabelSynced: vi.fn(),
				setAdapterCapabilities: vi.fn(),
				setMessagesSynced,
				setPresentationSynced,
				setQueueSynced: vi.fn(),
				setSessionMetadataSynced,
				statusRef: { current: "ready" },
			}),
		);

		await act(async () => {
			EventSourceStub.instances[0]?.onmessage?.(
				new MessageEvent("message", {
					data: JSON.stringify({ type: "state", state: { name: "agent_settled" } }),
				}),
			);
		});
		sessionMetadataRef.current = { sessionId: "session-b" };
		await act(async () => {
			resolveSession({ messages: [], presentation: EMPTY_PRESENTATION, session: { sessionId: "session-a" } });
			await Promise.resolve();
		});

		expect(setMessagesSynced).not.toHaveBeenCalled();
		expect(setPresentationSynced).not.toHaveBeenCalled();
		expect(setSessionMetadataSynced).not.toHaveBeenCalled();
	});

	it("ignores queued frames from a closed session stream after a session switch", async () => {
		class EventSourceStub {
			static instances: EventSourceStub[] = [];
			readonly close = vi.fn();
			onerror: (() => void) | null = null;
			onmessage: ((event: MessageEvent<string>) => void) | null = null;
			constructor() {
				EventSourceStub.instances.push(this);
			}
		}
		vi.stubGlobal("EventSource", EventSourceStub);

		const setActivityLabelSynced = vi.fn();
		const { rerender } = renderHook(
			({ sessionId }) =>
				usePiChatSessionEvents({
					client: {} as ChatClient,
					presentationRef: { current: EMPTY_PRESENTATION },
					sessionId,
					sessionMetadataRef: { current: { sessionId } },
					setActivityLabelSynced,
					setAdapterCapabilities: vi.fn(),
					setMessagesSynced: vi.fn(),
					setPresentationSynced: vi.fn(),
					setQueueSynced: vi.fn(),
					setSessionMetadataSynced: vi.fn(),
					statusRef: { current: "ready" },
				}),
			{ initialProps: { sessionId: "session-a" } },
		);

		const staleSource = EventSourceStub.instances[0]!;
		rerender({ sessionId: "session-b" });
		await act(async () => {
			staleSource.onmessage?.(
				new MessageEvent("message", {
					data: JSON.stringify({ type: "state", state: { message: "stale state" } }),
				}),
			);
		});

		expect(staleSource.close).toHaveBeenCalledOnce();
		expect(setActivityLabelSynced).not.toHaveBeenCalled();
	});

	it("ignores a queued frame from a stream superseded by reconnect", async () => {
		vi.useFakeTimers();
		class EventSourceStub {
			static instances: EventSourceStub[] = [];
			readonly close = vi.fn();
			onerror: (() => void) | null = null;
			onmessage: ((event: MessageEvent<string>) => void) | null = null;
			constructor() {
				EventSourceStub.instances.push(this);
			}
		}
		vi.stubGlobal("EventSource", EventSourceStub);
		const setActivityLabelSynced = vi.fn();
		renderHook(() =>
			usePiChatSessionEvents({
				client: {} as ChatClient,
				presentationRef: { current: EMPTY_PRESENTATION },
				sessionId: "session-a",
				sessionMetadataRef: { current: { sessionId: "session-a" } },
				setActivityLabelSynced,
				setAdapterCapabilities: vi.fn(),
				setMessagesSynced: vi.fn(),
				setPresentationSynced: vi.fn(),
				setQueueSynced: vi.fn(),
				setSessionMetadataSynced: vi.fn(),
				statusRef: { current: "ready" },
			}),
		);

		const staleSource = EventSourceStub.instances[0]!;
		await act(async () => {
			staleSource.onerror?.();
			await vi.advanceTimersByTimeAsync(2_000);
		});
		await act(async () => {
			staleSource.onmessage?.(
				new MessageEvent("message", {
					data: JSON.stringify({ type: "state", state: { message: "stale state" } }),
				}),
			);
		});

		expect(EventSourceStub.instances).toHaveLength(2);
		expect(setActivityLabelSynced).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
});
