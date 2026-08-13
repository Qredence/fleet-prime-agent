import type { ChatMessage, ChatMessagePart } from "@prime-agent/web-protocol/chat-types";

let assistantMessageSequence = 0;

/**
 * Builds a typed assistant `ChatMessage` for locally constructed messages
 * (e.g. error injections). Each call emits a unique id derived from the
 * provided id prefix so repeated injections never collide on React keys.
 */
export function createAssistantMessage(id: string, parts: Array<ChatMessagePart>): ChatMessage {
	assistantMessageSequence += 1;
	return {
		id: `${id}-${assistantMessageSequence}`,
		role: "assistant",
		parts,
	};
}
