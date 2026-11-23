import type { ChatState, ChatStore } from "@/hooks/chat/chat-store";
import { createChatState, createChatStore } from "@/hooks/chat/chat-store";

export type ChatStoreFixture = {
	/** The production store, wired to a plain variable instead of React state. */
	store: ChatStore;
	/** Current state; same value as `store.read()`, named for readable assertions. */
	get: () => ChatState;
	/** Every state the store published, in order. */
	changes: Array<ChatState>;
};

/**
 * Build a chat store outside React.
 *
 * Tests that only exercise store behavior — SSE frame handling, bootstrap
 * ordering — do not need a render tree, and driving the production store keeps
 * them honest about what the code under test actually writes.
 */
export function createChatStoreFixture(initial: Partial<ChatState> = {}): ChatStoreFixture {
	let state: ChatState = { ...createChatState(initial.sessionMetadata ?? {}), ...initial };
	const changes: Array<ChatState> = [];
	const store = createChatStore(state, {
		onChange: (next) => {
			state = next;
			changes.push(next);
		},
	});
	return { store, get: () => state, changes };
}
