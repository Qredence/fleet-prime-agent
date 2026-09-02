import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";

export type ConversationTurn = {
	user?: ChatMessage;
	assistants: Array<ChatMessage>;
};

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
