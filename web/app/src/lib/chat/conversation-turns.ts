import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";

export type ConversationTurn = {
	user?: ChatMessage;
	assistants: Array<ChatMessage>;
};

/**
 * Groups chat messages into conversation turns.
 *
 * @param messages - The chat messages to group by user and assistant exchanges
 * @returns The conversation turns, including assistant-only turns when applicable
 */
export function groupMessages(messages: Array<ChatMessage>): Array<ConversationTurn> {
	const turns: Array<ConversationTurn> = [];
	let current: ConversationTurn | undefined;

	for (const message of messages) {
		if (message.role === "user") {
			if (current) turns.push(current);
			current = { user: message, assistants: [] };
			continue;
		}
		if (message.role !== "assistant") continue;
		if (!current || message.source === "local") {
			if (current) turns.push(current);
			current = { assistants: [message] };
			continue;
		}
		current.assistants.push(message);
	}

	if (current) turns.push(current);
	return turns;
}
