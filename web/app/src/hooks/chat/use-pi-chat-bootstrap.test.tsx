import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatClient } from "@/lib/chat/chat-client";
import { EMPTY_SESSION_PRESENTATION } from "@/lib/chat/chat-stream-state";
import { createChatStoreFixture } from "@/test/chat-store-fixture";
import { usePiChatBootstrap } from "@/hooks/chat/use-pi-chat";

describe("usePiChatBootstrap", () => {
	it("does not hydrate after unmount while the initial session list is still pending", async () => {
		let resolveSessions!: (sessions: Array<ChatSessionInfo>) => void;
		const refreshSessions = vi.fn(
			() =>
				new Promise<Array<ChatSessionInfo>>((resolve) => {
					resolveSessions = resolve;
				}),
		);
		const { store, changes } = createChatStoreFixture({ sessionMetadata: { sessionId: "session-a" } });
		const initializedRef = { current: false };
		const { unmount } = renderHook(() =>
			usePiChatBootstrap({
				client: {
					loadSession: vi.fn().mockResolvedValue({
						messages: [],
						planPresentations: [],
						presentation: EMPTY_SESSION_PRESENTATION,
						session: { sessionId: "session-a" },
					}),
				} as unknown as ChatClient,
				initialSessionMetadataRef: { current: { sessionId: "session-a" } },
				initializedRef,
				resumeRequestRef: { current: 0 },
				recoverFromForbiddenSession: vi.fn(),
				refreshSessions,
				store,
			}),
		);

		changes.length = 0;
		unmount();
		expect(initializedRef.current).toBe(false);
		await act(async () => {
			resolveSessions([{ sessionId: "session-a" } as ChatSessionInfo]);
			await Promise.resolve();
		});

		expect(changes).toEqual([]);
	});
});
