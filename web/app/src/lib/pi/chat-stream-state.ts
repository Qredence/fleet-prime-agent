import type {
	ChatSessionMetadata,
	ChatStreamEvent,
	FleetAdapterCapabilities,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import type { QueueState } from "./chat-fetch";
import { labelForState } from "./chat-fetch";
import {
	appendAssistantDelta,
	createTextMessage,
	stripLegacyThinkingParts,
	upsertAssistantReasoningPresentation,
	upsertAssistantToolPart,
} from "./chat-message-helpers";

export type ChatStreamSnapshot = {
	adapterCapabilities?: FleetAdapterCapabilities;
	activityLabel?: string;
	messages: Array<ChatMessage>;
	planLabel?: string;
	queue: QueueState;
	sessionMetadata: ChatSessionMetadata;
};

export type ChatStreamTransition = {
	assistantId: string | null;
	snapshot: ChatStreamSnapshot;
};

export const EMPTY_QUEUE_STATE: QueueState = {
	steering: [],
	followUp: [],
};

/** Drop blank session fields so `{}` is a real clear, not a keep-if-empty merge. */
export function normalizeSessionMetadata(metadata: ChatSessionMetadata): ChatSessionMetadata {
	const sessionId = metadata.sessionId?.trim() || undefined;
	const projectId = metadata.projectId?.trim() || undefined;
	return sessionId || projectId ? { ...(sessionId ? { sessionId } : {}), ...(projectId ? { projectId } : {}) } : {};
}

function mergeSessionMetadata(
	current: ChatSessionMetadata,
	incoming: { sessionId?: string; projectId?: string | null },
): ChatSessionMetadata {
	const sessionId = incoming.sessionId?.trim() || current.sessionId;
	const projectId = incoming.projectId?.trim() || current.projectId;
	return {
		...(sessionId ? { sessionId } : {}),
		...(projectId ? { projectId } : {}),
	};
}

function hasRenderableParts(message: ChatMessage): boolean {
	return (message.parts ?? []).some((part) => {
		if (part.type === "text") {
			return typeof part.text === "string" && part.text.trim().length > 0;
		}
		return true;
	});
}

/**
 * Reconcile the in-flight assistant bubble id with a streamed `messageId`.
 * The `start` frame may open a placeholder id before the mapper assigns
 * `run-…-a0`; rename (or create) the bubble once without re-entering the
 * event reducer.
 */
function reconcileAssistantId(transition: ChatStreamTransition, messageId: string | undefined): ChatStreamTransition {
	if (!messageId) return transition;
	const { assistantId, snapshot } = transition;
	if (assistantId === messageId) return transition;

	if (assistantId) {
		const renamed = snapshot.messages.map((message) =>
			message.id === assistantId && message.role === "assistant" ? { ...message, id: messageId } : message,
		);
		return {
			assistantId: messageId,
			snapshot: { ...snapshot, messages: renamed },
		};
	}

	return {
		assistantId: messageId,
		snapshot: {
			...snapshot,
			messages: [...snapshot.messages, createTextMessage("assistant", "", messageId)],
		},
	};
}

function replaceOrAppendMessage(messages: Array<ChatMessage>, nextMessage: ChatMessage) {
	return messages.some((message) => message.id === nextMessage.id)
		? messages.map((message) => (message.id === nextMessage.id ? nextMessage : message))
		: [...messages, nextMessage];
}

/**
 * Merge a `done` frame into the transcript. When `done` arrives with an empty
 * body, keep renderable parts already streamed into this turn's bubble
 * (matched by `assistantId` / `nextMessage.id` only — never a prior turn).
 */
function carryForwardReasoningPresentation(
	messages: Array<ChatMessage>,
	nextMessage: ChatMessage,
	assistantId: string | null,
): ChatMessage {
	const candidates = [
		assistantId ? messages.find((message) => message.id === assistantId && message.role === "assistant") : undefined,
		messages.find((message) => message.id === nextMessage.id && message.role === "assistant"),
	].filter(Boolean) as Array<ChatMessage>;
	const presentation = candidates
		.flatMap((message) => message.parts)
		.filter((part) => part.type === "tool-FleetReasoning");
	if (presentation.length === 0 || nextMessage.parts.some((part) => part.type === "tool-FleetReasoning")) {
		return nextMessage;
	}
	return { ...nextMessage, parts: [...presentation, ...nextMessage.parts] };
}

function replaceOrAppendInFlight(
	messages: Array<ChatMessage>,
	nextMessage: ChatMessage,
	assistantId: string | null,
): Array<ChatMessage> {
	if (!hasRenderableParts(nextMessage)) {
		const candidates = [
			assistantId ? messages.find((m) => m.id === assistantId && m.role === "assistant") : undefined,
			messages.find((m) => m.id === nextMessage.id && m.role === "assistant"),
		].filter(Boolean) as Array<ChatMessage>;
		const donor = candidates.find((m) => hasRenderableParts(m));
		if (donor) {
			return replaceOrAppendMessage(messages, {
				...nextMessage,
				parts: donor.parts,
				createdAt: nextMessage.createdAt ?? donor.createdAt,
			});
		}
	}

	if (messages.some((m) => m.id === nextMessage.id)) {
		return messages.map((m) => (m.id === nextMessage.id ? nextMessage : m));
	}
	if (assistantId && assistantId !== nextMessage.id) {
		const matched = messages.some((m) => m.id === assistantId && m.role === "assistant");
		if (matched) {
			return messages.map((m) => (m.id === assistantId && m.role === "assistant" ? nextMessage : m));
		}
	}
	return [...messages, nextMessage];
}

export function applyChatStreamEvent(transition: ChatStreamTransition, event: ChatStreamEvent): ChatStreamTransition {
	if (event.type === "start") {
		const alreadyPresent = transition.snapshot.messages.some(
			(message) => message.id === event.id && message.role === "assistant",
		);
		return {
			assistantId: event.id,
			snapshot: {
				...transition.snapshot,
				adapterCapabilities: event.adapterCapabilities,
				activityLabel: event.sessionReset ? "Started a fresh Pi session" : event.diagnostics?.[0],
				messages: alreadyPresent
					? transition.snapshot.messages
					: [...transition.snapshot.messages, createTextMessage("assistant", "", event.id)],
				sessionMetadata: mergeSessionMetadata(transition.snapshot.sessionMetadata, {
					sessionId: event.sessionId,
				}),
			},
		};
	}

	const reconciled =
		event.type === "delta" || event.type === "thinking" || event.type === "reasoning" || event.type === "tool"
			? reconcileAssistantId(transition, event.messageId)
			: transition;
	const { assistantId, snapshot } = reconciled;

	if (event.type === "delta" && assistantId) {
		return {
			assistantId,
			snapshot: {
				...snapshot,
				messages: appendAssistantDelta(snapshot.messages, assistantId, event.text),
			},
		};
	}

	if (event.type === "thinking") {
		// Legacy adapters may still emit raw detailed thinking. It is intentionally
		// ignored in the standard Fleet transcript.
		return reconciled;
	}

	if (
		event.type === "reasoning" &&
		assistantId &&
		snapshot.adapterCapabilities?.features.includes("reasoning-summary-v1")
	) {
		return {
			assistantId,
			snapshot: {
				...snapshot,
				messages: upsertAssistantReasoningPresentation(snapshot.messages, assistantId, event.presentation),
			},
		};
	}

	if (event.type === "tool" && assistantId) {
		return {
			assistantId,
			snapshot: {
				...snapshot,
				messages: upsertAssistantToolPart(snapshot.messages, assistantId, event.part),
			},
		};
	}

	if (event.type === "queue") {
		return {
			assistantId,
			snapshot: {
				...snapshot,
				queue: { steering: event.steering, followUp: event.followUp },
			},
		};
	}

	if (event.type === "plan") {
		return {
			assistantId,
			snapshot: {
				...snapshot,
				planLabel: event.message,
			},
		};
	}

	if (event.type === "state") {
		return {
			assistantId,
			snapshot: {
				...snapshot,
				activityLabel: labelForState(event.state.name),
			},
		};
	}

	if (event.type === "compaction") {
		return {
			assistantId,
			snapshot: {
				...snapshot,
				activityLabel: event.phase === "start" ? "Compacting session" : "Compaction finished",
			},
		};
	}

	if (event.type === "retry") {
		return {
			assistantId,
			snapshot: {
				...snapshot,
				activityLabel:
					event.phase === "start"
						? `Retrying request ${event.attempt}/${event.maxAttempts}`
						: event.success
							? "Retry succeeded"
							: "Retry failed",
			},
		};
	}

	if (event.type === "done") {
		const sanitized = stripLegacyThinkingParts(event.message);
		const completed = carryForwardReasoningPresentation(snapshot.messages, sanitized, assistantId);
		const merged = replaceOrAppendInFlight(snapshot.messages, completed, assistantId);
		return {
			assistantId: null,
			snapshot: {
				...snapshot,
				activityLabel: undefined,
				messages: merged.map((message) => stripLegacyThinkingParts(message)),
				queue: EMPTY_QUEUE_STATE,
				sessionMetadata: mergeSessionMetadata(snapshot.sessionMetadata, {
					sessionId: event.sessionId,
				}),
			},
		};
	}

	return reconciled;
}
