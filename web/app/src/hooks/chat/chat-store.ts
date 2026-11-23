import type {
	ChatSessionMetadata,
	ChatStreamEvent,
	FleetAdapterCapabilities,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useState } from "react";
import type { QueueState } from "@/lib/chat/chat-fetch";
import {
	applyChatStreamEvent,
	EMPTY_QUEUE_STATE,
	EMPTY_SESSION_PRESENTATION,
	normalizeSessionMetadata,
} from "@/lib/chat/chat-stream-state";

/**
 * Everything the chat UI knows about the visible conversation.
 *
 * The first seven fields are exactly `ChatStreamSnapshot` — the shape
 * `applyChatStreamEvent` already reduces over — so a stream event can be applied
 * to this state directly instead of being assembled from, and scattered back
 * into, separate pieces of React state.
 */
export type ChatState = {
	adapterCapabilities?: FleetAdapterCapabilities;
	activityLabel?: string;
	messages: Array<ChatMessage>;
	planLabel?: string;
	presentation: PrimeAgentSessionPresentation;
	queue: QueueState;
	sessionMetadata: ChatSessionMetadata;
	error: Error | null;
	/**
	 * Bumped whenever the queue or the session changes. Optimistic queue
	 * mutations capture it before awaiting the server and compare afterwards: an
	 * unchanged revision means the captured index still points at the same item.
	 */
	queueRevision: number;
	status: ChatStatus;
};

export type ChatStatePatch = Partial<ChatState>;

/**
 * The conversation fields a cleared session resets to. Project switches,
 * session deletes, new sessions, and forbidden/unknown-session recovery all
 * start from this and spread in whatever else that particular reset owns.
 */
export const CLEARED_CONVERSATION = {
	activityLabel: undefined,
	messages: [],
	planLabel: undefined,
	presentation: EMPTY_SESSION_PRESENTATION,
	queue: EMPTY_QUEUE_STATE,
} satisfies ChatStatePatch;

/**
 * Stable handle to the chat state. Every member keeps its identity for the
 * lifetime of the hook, so effects and callbacks can depend on the whole store.
 */
export type ChatStore = {
	/** Synchronous read for callbacks and effects that must not close over a render. */
	read: () => ChatState;
	/** Merge a partial update. A patch that changes nothing does not re-render. */
	patch: (next: ChatStatePatch | ((current: ChatState) => ChatStatePatch)) => void;
	/** Apply one stream event and return the assistant message id to carry forward. */
	applyEvent: (assistantId: string | null, event: ChatStreamEvent) => string | null;
	/** Invalidate in-flight optimistic queue mutations without touching the queue. */
	invalidateQueue: () => void;
};

const PATCHABLE_KEYS = [
	"adapterCapabilities",
	"activityLabel",
	"messages",
	"planLabel",
	"presentation",
	"queue",
	"sessionMetadata",
	"error",
	"queueRevision",
	"status",
] as const satisfies ReadonlyArray<keyof ChatState>;

export function createChatState(sessionMetadata: ChatSessionMetadata): ChatState {
	return {
		...CLEARED_CONVERSATION,
		error: null,
		queueRevision: 0,
		sessionMetadata,
		status: "ready",
	};
}

/**
 * Merge a patch into chat state.
 *
 * Returns `current` itself when the patch changes nothing, so callers can skip
 * the render. `sessionMetadata` keeps its previous identity whenever the session
 * is unchanged, which makes "did the user move to another session?" a reference
 * comparison rather than a field-by-field one.
 */
export function mergeChatState(current: ChatState, delta: ChatStatePatch): ChatState {
	const merged: ChatState = { ...current, ...delta };

	if (delta.sessionMetadata !== undefined) {
		const normalized = normalizeSessionMetadata(merged.sessionMetadata);
		const unchanged =
			normalized.sessionId === current.sessionMetadata.sessionId &&
			normalized.projectId === current.sessionMetadata.projectId;
		merged.sessionMetadata = unchanged ? current.sessionMetadata : normalized;
		if (!unchanged) merged.queueRevision += 1;
	}
	if (merged.queue !== current.queue) merged.queueRevision += 1;

	if (PATCHABLE_KEYS.every((key) => merged[key] === current[key])) return current;
	return merged;
}

export type ChatStoreOptions = {
	/** Receives the new state whenever a patch changed something. */
	onChange: (state: ChatState) => void;
	/** Receives the new session whenever the session itself changed. */
	persistSession?: (metadata: ChatSessionMetadata) => void;
};

/**
 * Owns the visible conversation as one value.
 *
 * Plain object, no React: the store holds the authoritative state and pushes
 * every change through `onChange`. `useChatStore` wraps it for rendering, and
 * tests drive it directly.
 *
 * Both callbacks are captured once, so they must be referentially stable.
 */
export function createChatStore(initial: ChatState, { onChange, persistSession }: ChatStoreOptions): ChatStore {
	let state = initial;

	const patch: ChatStore["patch"] = (next) => {
		const merged = mergeChatState(state, typeof next === "function" ? next(state) : next);
		if (merged === state) return;
		const switchedSession = merged.sessionMetadata !== state.sessionMetadata;
		state = merged;
		onChange(merged);
		if (switchedSession) persistSession?.(merged.sessionMetadata);
	};

	return {
		read: () => state,
		patch,
		applyEvent: (assistantId, event) => {
			const transition = applyChatStreamEvent({ assistantId, snapshot: state }, event);
			const { snapshot } = transition;
			patch({
				adapterCapabilities: snapshot.adapterCapabilities,
				activityLabel: snapshot.activityLabel,
				messages: snapshot.messages,
				planLabel: snapshot.planLabel,
				// The reducer carries the presentation through untouched, so an absent
				// value means "no opinion", not "clear the presentation".
				...(snapshot.presentation ? { presentation: snapshot.presentation } : {}),
				queue: snapshot.queue,
				sessionMetadata: snapshot.sessionMetadata,
			});
			return transition.assistantId;
		},
		invalidateQueue: () => patch((current) => ({ queueRevision: current.queueRevision + 1 })),
	};
}

/**
 * Renders the chat state and hands back a store whose identity never changes,
 * so effects and callbacks can depend on the whole store.
 *
 * `persistSession` is called on every session switch, never for the session the
 * hook started from — that one already came from storage. It is captured on the
 * first render, so it must be referentially stable.
 *
 * @returns The render-time state and a stable store handle.
 */
export function useChatStore(
	initialSessionMetadata: ChatSessionMetadata,
	persistSession: (metadata: ChatSessionMetadata) => void,
): [ChatState, ChatStore] {
	const [state, setState] = useState<ChatState>(() => createChatState(initialSessionMetadata));
	// Created once from the first render's state; the store owns it from then on
	// and republishes every change through `setState`.
	const [store] = useState<ChatStore>(() => createChatStore(state, { onChange: setState, persistSession }));

	return [state, store];
}
