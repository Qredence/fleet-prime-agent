import type { ChatPlanPresentation } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { upsertToolPart } from "./chat-message-helpers";
import { createPlanToolPartFromChatPlanState } from "./plan-state";

export function hydratePlanPresentationMessages(
	messages: Array<ChatMessage>,
	presentations: readonly ChatPlanPresentation[],
) {
	const byAssistantId = new Map(presentations.map((presentation) => [presentation.assistantMessageId, presentation]));
	return messages.map((message) => {
		if (message.role !== "assistant") return message;
		const presentation = byAssistantId.get(message.id);
		const part = presentation ? createPlanToolPartFromChatPlanState(message.id, presentation.state) : undefined;
		return part ? { ...message, parts: upsertToolPart(message.parts, part) } : message;
	});
}
export function planPresentationForToolCall(
	messages: readonly ChatMessage[],
	toolCallId: string | undefined,
): ChatPlanPresentation | undefined {
	for (const message of messages)
		for (const part of message.parts) {
			if (
				part.type !== "tool-PlanWrite" ||
				part.toolCallId !== toolCallId ||
				!part.input ||
				typeof part.input !== "object"
			)
				continue;
			const state = (part.input as { presentation?: unknown }).presentation;
			if (!state || typeof state !== "object") continue;
			const candidate = state as ChatPlanPresentation["state"];
			if (
				!Array.isArray(candidate.todos) ||
				(candidate.mode !== "agent" && candidate.mode !== "plan" && candidate.mode !== "harness")
			)
				continue;
			return {
				assistantMessageId: message.id,
				state: { ...candidate, todos: candidate.todos.map((todo) => ({ ...todo })) },
			};
		}
	return undefined;
}
