import type { ChatQuestionAnswer } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { createContext, useContext } from "react";
import { isPlanDecisionToolCall } from "@/lib/chat/plan-state";

export type QuestionAnswerHandler = (input: { toolCallId?: string; answer: ChatQuestionAnswer }) => Promise<unknown>;

export const PlanDecisionContext = createContext<QuestionAnswerHandler | null>(null);
export const usePlanDecision = () => useContext(PlanDecisionContext);

function presentationAfterDecision(input: unknown, answer: ChatQuestionAnswer): unknown {
	if (!input || typeof input !== "object") return undefined;
	const current = (input as { presentation?: unknown }).presentation;
	if (!current || typeof current !== "object") return current;
	const selected = answer.selectedIds?.[0];
	const snapshot = current as Record<string, unknown>;
	const todos = Array.isArray(snapshot.todos) ? snapshot.todos : [];
	const hasIncomplete = todos.some((todo) =>
		Boolean(todo && typeof todo === "object" && !(todo as { completed?: unknown }).completed),
	);
	return {
		...snapshot,
		pendingDecision: false,
		mode: selected === "execute" ? "agent" : "plan",
		executing: selected === "execute" ? hasIncomplete : false,
	};
}

export function resolvePlanDecisionMessages(
	currentMessages: Array<ChatMessage>,
	toolCallId: string | undefined,
	answer: ChatQuestionAnswer,
) {
	if (!isPlanDecisionToolCall(toolCallId)) return currentMessages;

	const nextMessages = currentMessages.map((message) => {
		const nextParts = message.parts.map((part) => {
			if (
				part.type !== "tool-PlanWrite" ||
				part.toolCallId !== toolCallId ||
				!part.input ||
				typeof part.input !== "object"
			) {
				return part;
			}

			return {
				...part,
				input: {
					...(part.input as Record<string, unknown>),
					approved: answer.selectedIds?.[0] === "execute" || answer.selectedIds?.[0] === "stay",
					pendingDecision: false,
					// Keep the top-level field in sync with the nested presentation:
					// renderers gate on input.executing directly.
					executing: answer.selectedIds?.[0] === "execute",
					presentation: presentationAfterDecision(part.input, answer),
				},
			};
		});

		const partsChanged = nextParts.some((part, index) => part !== message.parts[index]);
		if (!partsChanged) return message;
		return { ...message, parts: nextParts };
	});

	return nextMessages.some((message, index) => message !== currentMessages[index]) ? nextMessages : currentMessages;
}
