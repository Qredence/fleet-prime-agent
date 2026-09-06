import type { ChatSessionInfo, PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatClient } from "./chat-client";
import { usePiChatBootstrap } from "./use-pi-chat-bootstrap";

const EMPTY_PRESENTATION: PrimeAgentSessionPresentation = {
	artifactRuns: [],
	refinements: [],
	rlmChildren: [],
	revision: 0,
	userBash: [],
};

describe("usePiChatBootstrap", () => {
	it("does not hydrate after unmount while the initial session list is still pending", async () => {
		let resolveSessions!: (sessions: Array<ChatSessionInfo>) => void;
		const refreshSessions = vi.fn(
			() =>
				new Promise<Array<ChatSessionInfo>>((resolve) => {
					resolveSessions = resolve;
				}),
		);
		const setSessionMetadataSynced = vi.fn();
		const setMessagesSynced = vi.fn();
		const setPresentationSynced = vi.fn();
		const initializedRef = { current: false };
		const { unmount } = renderHook(() =>
			usePiChatBootstrap({
				client: {
					loadSession: vi.fn().mockResolvedValue({
						messages: [],
						planPresentations: [],
						presentation: EMPTY_PRESENTATION,
						session: { sessionId: "session-a" },
					}),
				} as unknown as ChatClient,
				initialSessionMetadataRef: { current: { sessionId: "session-a" } },
				initializedRef,
				recoverFromForbiddenSession: vi.fn(),
				refreshSessions,
				setActivityLabelSynced: vi.fn(),
				setError: vi.fn(),
				setMessagesSynced,
				setPlanLabelSynced: vi.fn(),
				setPresentationSynced,
				setQueueSynced: vi.fn(),
				setSessionMetadataSynced,
				setStatus: vi.fn(),
			}),
		);

		setSessionMetadataSynced.mockClear();
		setMessagesSynced.mockClear();
		setPresentationSynced.mockClear();
		unmount();
		expect(initializedRef.current).toBe(false);
		await act(async () => {
			resolveSessions([{ sessionId: "session-a" } as ChatSessionInfo]);
			await Promise.resolve();
		});

		expect(setSessionMetadataSynced).not.toHaveBeenCalled();
		expect(setMessagesSynced).not.toHaveBeenCalled();
		expect(setPresentationSynced).not.toHaveBeenCalled();
	});
});
