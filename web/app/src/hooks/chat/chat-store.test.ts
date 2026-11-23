import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createChatState, mergeChatState, useChatStore } from "@/hooks/chat/chat-store";
import { EMPTY_QUEUE_STATE, EMPTY_SESSION_PRESENTATION } from "@/lib/chat/chat-stream-state";
import { createChatStoreFixture } from "@/test/chat-store-fixture";

describe("mergeChatState", () => {
	it("returns the same state for a patch that changes nothing", () => {
		const current = createChatState({ sessionId: "a" });
		expect(mergeChatState(current, { status: "ready" })).toBe(current);
		expect(mergeChatState(current, { queue: EMPTY_QUEUE_STATE })).toBe(current);
		expect(mergeChatState(current, {})).toBe(current);
	});

	it("keeps the session object identity when the session is unchanged", () => {
		const current = createChatState({ sessionId: "a", projectId: "p" });
		expect(mergeChatState(current, { sessionMetadata: { sessionId: "a", projectId: "p" } })).toBe(current);
	});

	it("normalizes the session and bumps the queue revision when it changes", () => {
		const current = createChatState({ sessionId: "a" });
		const next = mergeChatState(current, { sessionMetadata: { sessionId: "  b  ", projectId: "" } });
		expect(next.sessionMetadata).toEqual({ sessionId: "b" });
		expect(next.queueRevision).toBe(current.queueRevision + 1);
	});

	it("bumps the queue revision only when the queue value actually changes", () => {
		const current = createChatState({ sessionId: "a" });
		const queued = mergeChatState(current, { queue: { steering: ["one"], followUp: [] } });
		expect(queued.queueRevision).toBe(current.queueRevision + 1);
		expect(mergeChatState(queued, { queue: queued.queue })).toBe(queued);
	});

	it("does not treat an absent key as a clear", () => {
		const current = mergeChatState(createChatState({}), { activityLabel: "Thinking" });
		expect(mergeChatState(current, { messages: [] }).activityLabel).toBe("Thinking");
	});
});

describe("createChatStore", () => {
	it("publishes a change only when the patch changed something", () => {
		const { store, changes } = createChatStoreFixture({ sessionMetadata: { sessionId: "a" } });

		store.patch({ sessionMetadata: { sessionId: "a" } });
		expect(changes).toEqual([]);

		store.patch({ sessionMetadata: { sessionId: "b" } });
		expect(changes).toHaveLength(1);
		expect(store.read().sessionMetadata).toEqual({ sessionId: "b" });
	});

	it("applies a stream event through the shared reducer and reports the assistant id", () => {
		const { store } = createChatStoreFixture({ sessionMetadata: { sessionId: "a" } });

		const assistantId = store.applyEvent(null, { type: "start", id: "reply-1", runId: "run-1", sessionId: "a" });
		expect(assistantId).toBe("reply-1");

		store.applyEvent(assistantId, { type: "delta", text: "hello" });
		expect(store.read().messages).toMatchObject([{ id: "reply-1", parts: [{ type: "text", text: "hello" }] }]);
	});

	it("never clears the presentation when an event has no opinion about it", () => {
		const presentation = { ...EMPTY_SESSION_PRESENTATION, revision: 3 };
		const { store } = createChatStoreFixture({ presentation, sessionMetadata: { sessionId: "a" } });

		store.applyEvent(null, { type: "queue", steering: ["queued"], followUp: [] });
		expect(store.read().presentation).toBe(presentation);
		expect(store.read().queue).toEqual({ steering: ["queued"], followUp: [] });
	});

	it("invalidates queue mutations without touching the queue", () => {
		const { store } = createChatStoreFixture({ sessionMetadata: { sessionId: "a" } });
		const before = store.read();
		store.invalidateQueue();
		expect(store.read().queueRevision).toBe(before.queueRevision + 1);
		expect(store.read().queue).toBe(before.queue);
	});
});

describe("useChatStore", () => {
	it("persists a session switch but not the session it started from", () => {
		const persistSession = vi.fn();
		const { result, rerender } = renderHook(() => useChatStore({ sessionId: "a" }, persistSession));
		rerender();
		expect(persistSession).not.toHaveBeenCalled();

		const [, store] = result.current;
		store.patch({ sessionMetadata: { sessionId: "b", projectId: "p" } });
		rerender();
		expect(persistSession).toHaveBeenCalledExactlyOnceWith({ sessionId: "b", projectId: "p" });

		store.patch({ sessionMetadata: { sessionId: "b", projectId: "p" } });
		rerender();
		expect(persistSession).toHaveBeenCalledOnce();
	});

	it("hands back the same store across renders", () => {
		const { result, rerender } = renderHook(() => useChatStore({}, vi.fn()));
		const first = result.current[1];
		result.current[1].patch({ status: "streaming" });
		rerender();
		expect(result.current[1]).toBe(first);
		expect(result.current[0].status).toBe("streaming");
	});
});
