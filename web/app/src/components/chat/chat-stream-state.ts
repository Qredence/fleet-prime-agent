import type {
	ChatSessionMetadata,
	ChatStreamEvent,
	FleetAdapterCapabilities,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatMessagePart } from "@prime-agent/web-protocol/chat-types";
import { isChatTextPart, isChatToolPart } from "@prime-agent/web-protocol/chat-types";
import type { QueueState } from "@/components/chat/chat-fetch";
import { labelForState } from "@/components/chat/chat-fetch";
import {
	appendAssistantDelta,
	applyAssistantReasoningText,
	createTextMessage,
	stripLegacyThinkingParts,
	upsertAssistantPayloadPart,
	upsertAssistantReasoningPresentation,
	upsertAssistantToolPart,
} from "@/components/chat/chat-message-helpers";

export type ChatStreamSnapshot = {
	adapterCapabilities?: FleetAdapterCapabilities;
	activityLabel?: string;
	messages: Array<ChatMessage>;
	planLabel?: string;
	presentation?: PrimeAgentSessionPresentation;
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

/**
 * The cleared-session presentation: initial state, project switch, session
 * delete, and forbidden/unknown-session recovery all reset to exactly this.
 *
 * `PrimeAgentSessionPresentation` has five required fields and eight optional
 * ones. Spelling the literal out at each reset site silently drops any field
 * that later becomes required there, so resets share this one frozen value.
 * Consumers replace the whole presentation instead of mutating it in place, so
 * sharing the reference is safe.
 */
export const EMPTY_SESSION_PRESENTATION: PrimeAgentSessionPresentation = Object.freeze({
	revision: 0,
	userBash: [],
	rlmChildren: [],
	refinements: [],
	artifactRuns: [],
});

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

function payloadPartsMatch(left: ChatMessagePart, right: ChatMessagePart) {
	if (left.type !== "payload" || right.type !== "payload") return false;
	return left.id && right.id ? left.id === right.id : left.kind === right.kind && left.title === right.title;
}

/** True when a carried reasoning, payload, or Fleet reasoning part has no unused terminal match. */
function hasUnmatchedCarriedPart(donorParts: Array<ChatMessagePart>, terminalParts: Array<ChatMessagePart>) {
	const consumed = new Set<number>();
	const take = (matches: (candidate: ChatMessagePart) => boolean) => {
		const index = terminalParts.findIndex((candidate, candidateIndex) => {
			return !consumed.has(candidateIndex) && matches(candidate);
		});
		if (index < 0) return false;
		consumed.add(index);
		return true;
	};

	for (const part of donorParts) {
		if (part.type === "reasoning") {
			const matched = take(
				(candidate) => candidate.type === "reasoning" && candidate.contentIndex === part.contentIndex,
			);
			if (!matched) return true;
			continue;
		}
		if (part.type === "payload") {
			if (!take((candidate) => payloadPartsMatch(part, candidate))) return true;
			continue;
		}
		if (part.type === "tool-FleetReasoning") {
			if (!take((candidate) => candidate.type === "tool-FleetReasoning")) return true;
		}
	}
	return false;
}

/**
 * Keep terminal `done` ordering authoritative while carrying streamed-only parts
 * forward at the position of the next streamed part represented in the terminal.
 */
function mergeStreamedPartsOntoTerminal(
	streamedParts: Array<ChatMessagePart>,
	terminalParts: Array<ChatMessagePart>,
): Array<ChatMessagePart> {
	const consumed = new Set<number>();
	const streamedToTerminal = new Map<number, number>();
	const terminalToStreamed = new Map<number, ChatMessagePart>();
	const takeTerminalIndex = (matches: (candidate: ChatMessagePart) => boolean) => {
		const index = terminalParts.findIndex((candidate, candidateIndex) => {
			return !consumed.has(candidateIndex) && matches(candidate);
		});
		if (index < 0) return undefined;
		consumed.add(index);
		return index;
	};

	for (let index = 0; index < streamedParts.length; index++) {
		const part = streamedParts[index]!;
		let terminalIndex: number | undefined;
		if (part.type === "reasoning") {
			terminalIndex = takeTerminalIndex(
				(candidate) => candidate.type === "reasoning" && candidate.contentIndex === part.contentIndex,
			);
		} else if (part.type === "payload") {
			terminalIndex = takeTerminalIndex((candidate) => payloadPartsMatch(part, candidate));
		} else if (part.type === "tool-FleetReasoning") {
			terminalIndex = takeTerminalIndex((candidate) => candidate.type === "tool-FleetReasoning");
		} else if (isChatToolPart(part)) {
			terminalIndex = takeTerminalIndex(
				(candidate) =>
					isChatToolPart(candidate) && candidate.toolCallId === part.toolCallId && candidate.type === part.type,
			);
		} else if (isChatTextPart(part)) {
			terminalIndex = takeTerminalIndex(isChatTextPart);
		}

		if (terminalIndex !== undefined) {
			streamedToTerminal.set(index, terminalIndex);
			terminalToStreamed.set(terminalIndex, part);
		}
	}

	const insertions = new Map<number, Array<ChatMessagePart>>();
	let nextTerminalIndex: number | undefined;
	for (let index = streamedParts.length - 1; index >= 0; index--) {
		const terminalIndex = streamedToTerminal.get(index);
		if (terminalIndex !== undefined) {
			nextTerminalIndex = terminalIndex;
			continue;
		}
		const part = streamedParts[index]!;
		if (part.type === "text" && part.text.trim().length === 0) continue;
		const anchor = nextTerminalIndex ?? terminalParts.length;
		const parts = insertions.get(anchor) ?? [];
		parts.push(part.type === "reasoning" ? { ...part, state: "complete" } : part);
		insertions.set(anchor, parts);
	}

	const merged: Array<ChatMessagePart> = [];
	for (let index = 0; index < terminalParts.length; index++) {
		const inserted = insertions.get(index);
		if (inserted) merged.push(...inserted.reverse());

		const terminalPart = terminalParts[index]!;
		const streamedPart = terminalToStreamed.get(index);
		if (terminalPart.type === "reasoning" && streamedPart?.type === "reasoning") {
			merged.push({ ...terminalPart, state: "complete" });
		} else if (terminalPart.type === "text" && streamedPart?.type === "text") {
			if (terminalPart.text.trim().length > 0) merged.push(terminalPart);
			else if (streamedPart.text.trim().length > 0) merged.push(streamedPart);
			else merged.push(terminalPart);
		} else {
			merged.push(terminalPart);
		}
	}
	const trailing = insertions.get(terminalParts.length);
	if (trailing) merged.push(...trailing.reverse());
	return merged;
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
	const donor = candidates[0];
	if (!donor) return nextMessage;
	if (!hasUnmatchedCarriedPart(donor.parts, nextMessage.parts)) return nextMessage;
	return {
		...nextMessage,
		parts: mergeStreamedPartsOntoTerminal(donor.parts, nextMessage.parts),
	};
}

/**
 * Merges an in-flight assistant message into the transcript.
 *
 * @param messages - The current transcript messages
 * @param nextMessage - The assistant message to merge
 * @param assistantId - The active assistant message identifier, if available
 * @returns The transcript with the message replaced or appended
 */
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

/**
 * Applies a chat stream event to the current transition and produces the updated chat state.
 *
 * @param transition - The current assistant identifier and chat stream snapshot
 * @param event - The stream event to apply
 * @returns The updated assistant identifier and chat stream snapshot
 */
export function applyChatStreamEvent(transition: ChatStreamTransition, event: ChatStreamEvent): ChatStreamTransition {
	if (event.type === "session_snapshot") {
		return {
			assistantId: null,
			snapshot: {
				...transition.snapshot,
				activityLabel: undefined,
				messages: event.messages,
				planLabel: undefined,
				presentation: event.presentation,
				queue: EMPTY_QUEUE_STATE,
				sessionMetadata: event.session,
			},
		};
	}

	// Runtime reattachment uses a synthetic done frame to mark the old
	// connection state as reset. The user turn is still in flight, so preserve
	// the current assistant bubble until the real terminal done arrives.
	if (event.type === "done" && event.sessionReset) return transition;

	if (event.type === "presentation") {
		const currentRevision = transition.snapshot.presentation?.revision ?? -1;
		if (event.presentation.revision <= currentRevision) return transition;
		return {
			...transition,
			snapshot: {
				...transition.snapshot,
				presentation: event.presentation,
			},
		};
	}

	if (event.type === "rlm") {
		const presentation = transition.snapshot.presentation;
		if (!presentation) return transition;
		// ChatRlmStreamEvent carries no revision, so the child timestamp is the
		// monotonic signal: drop stale redeliveries for the same child.
		const existingChild = presentation.rlmChildren.find((child) => child.id === event.child.id);
		if (existingChild && existingChild.timestamp > event.child.timestamp) return transition;
		const rlmChildren = [...presentation.rlmChildren.filter((child) => child.id !== event.child.id), event.child];
		return {
			...transition,
			snapshot: {
				...transition.snapshot,
				presentation: {
					...presentation,
					rlmChildren,
					...(event.tree ? { rlmTree: event.tree } : {}),
				},
			},
		};
	}

	if (event.type === "message") {
		if (event.message.role === "user") {
			const existingIndex = transition.snapshot.messages.findIndex((message) => message.id === event.message.id);
			const optimisticIndex =
				existingIndex >= 0
					? existingIndex
					: transition.snapshot.messages.findIndex(
							(message) => message.role === "user" && message.optimistic === true,
						);
			const message =
				optimisticIndex >= 0
					? { ...event.message, id: transition.snapshot.messages[optimisticIndex]!.id }
					: event.message;
			return {
				...transition,
				snapshot: {
					...transition.snapshot,
					messages:
						optimisticIndex >= 0
							? transition.snapshot.messages.map((current, index) =>
									index === optimisticIndex ? message : current,
								)
							: [...transition.snapshot.messages, message],
				},
			};
		}
		const reconciledMessage = reconcileAssistantId(transition, event.message.id);
		return {
			assistantId: reconciledMessage.assistantId,
			snapshot: {
				...reconciledMessage.snapshot,
				messages: replaceOrAppendInFlight(
					reconciledMessage.snapshot.messages,
					event.message,
					reconciledMessage.assistantId,
				),
			},
		};
	}

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

	// Older adapters may still send raw thinking frames. They are intentionally
	// ignored so detailed provider reasoning never reaches the transcript or UI.
	if (event.type === "thinking") return transition;

	const reconciled =
		event.type === "delta" ||
		event.type === "reasoning" ||
		event.type === "reasoning_text" ||
		event.type === "tool" ||
		event.type === "payload"
			? reconcileAssistantId(transition, event.messageId)
			: transition;
	const { assistantId, snapshot } = reconciled;
	if (event.type === "reasoning_text" && assistantId) {
		return {
			assistantId,
			snapshot: { ...snapshot, messages: applyAssistantReasoningText(snapshot.messages, assistantId, event) },
		};
	}

	if (event.type === "delta" && assistantId) {
		return {
			assistantId,
			snapshot: {
				...snapshot,
				messages: appendAssistantDelta(snapshot.messages, assistantId, event.text),
			},
		};
	}

	if (event.type === "error") {
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

	if (event.type === "payload" && assistantId) {
		return {
			assistantId,
			snapshot: {
				...snapshot,
				messages: upsertAssistantPayloadPart(snapshot.messages, assistantId, event.part),
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
		const terminalPresentation =
			event.presentation && event.presentation.revision > (snapshot.presentation?.revision ?? -1)
				? event.presentation
				: snapshot.presentation;
		return {
			assistantId: null,
			snapshot: {
				...snapshot,
				activityLabel: undefined,
				messages: merged.map((message) => stripLegacyThinkingParts(message)),
				queue: EMPTY_QUEUE_STATE,
				presentation: terminalPresentation,
				sessionMetadata: mergeSessionMetadata(snapshot.sessionMetadata, {
					sessionId: event.sessionId,
				}),
			},
		};
	}

	return reconciled;
}
