import type { ChatQuestionAnswer } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useEffect, useRef } from "react";
import { isQuestionToolPartPending } from "@/components/chat/question/question-pending";

type QuestionMessage = {
	role?: string;
	parts?: Array<{
		type?: string;
		toolCallId?: string;
		state?: string;
		output?: {
			answer?: unknown;
			answers?: Array<unknown>;
			content?: string;
			details?: unknown;
		};
	}>;
};

/** Resolves live questionnaire tool calls with the protocol's safe skip answer. */
export function useSkipPendingQuestion(
	messages: Array<ChatMessage>,
	status: ChatStatus,
	answerQuestion: (input: { toolCallId: string; answer: ChatQuestionAnswer }) => Promise<unknown>,
	onAnswerError: (error: unknown) => void,
) {
	const handledToolCalls = useRef(new Set<string>());

	useEffect(() => {
		if (status !== "streaming" && status !== "submitted") return;
		const activeUserMessageIndex = messages.findLastIndex((message) => message.role === "user");
		if (activeUserMessageIndex < 0) return;
		for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
			if (messageIndex <= activeUserMessageIndex) break;
			const message = messages[messageIndex] as unknown as QuestionMessage;
			if (message?.role !== "assistant" || !Array.isArray(message.parts)) continue;

			for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
				const part = message.parts[partIndex];
				if (
					part?.type !== "tool-Question" ||
					part.state !== "input-available" ||
					!part.toolCallId ||
					!isQuestionToolPartPending(part)
				) {
					continue;
				}
				if (handledToolCalls.current.has(part.toolCallId)) continue;
				const toolCallId = part.toolCallId;
				handledToolCalls.current.add(toolCallId);
				void answerQuestion({ toolCallId, answer: { kind: "skip" } }).catch(onAnswerError);
			}
		}
	}, [answerQuestion, messages, onAnswerError, status]);
}
