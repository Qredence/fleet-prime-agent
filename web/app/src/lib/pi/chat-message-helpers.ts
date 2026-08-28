import type { ChatReasoningPresentation } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatMessagePart, ChatPayloadPart, ChatToolPart } from "@prime-agent/web-protocol/chat-types";

export function createTextMessage(
	role: ChatMessage["role"],
	text: string,
	id: string = crypto.randomUUID(),
): ChatMessage {
	return {
		id,
		role,
		createdAt: Date.now(),
		parts: [{ type: "text", text }],
	};
}

export function createOptimisticUserMessage(text: string): ChatMessage {
	return { ...createTextMessage("user", text), optimistic: true };
}

export function removeOptimisticUserMessage(messages: Array<ChatMessage>, messageId: string): Array<ChatMessage> {
	return messages.filter((message) => message.id !== messageId || message.optimistic !== true);
}

export function settleOptimisticUserMessage(messages: Array<ChatMessage>, messageId: string): Array<ChatMessage> {
	return messages.map((message) => {
		if (message.id !== messageId || message.optimistic !== true) return message;
		const settled = { ...message };
		delete settled.optimistic;
		return settled;
	});
}

export function toChatMessage(
	id: string,
	role: ChatMessage["role"],
	parts: Array<ChatMessagePart>,
	createdAt: number = Date.now(),
): ChatMessage {
	return {
		id,
		role,
		createdAt,
		parts: parts.length > 0 ? parts : [{ type: "text", text: "" }],
	};
}

export function appendTextPart(parts: Array<ChatMessagePart>, delta: string) {
	const index = parts.findIndex((part) => part.type === "text");
	if (index === -1) return [...parts, { type: "text", text: delta }];

	const next = [...parts];
	const part = next[index];
	next[index] = part.type === "text" ? { ...part, text: `${part.text}${delta}` } : part;
	return next;
}

export function upsertToolPart(parts: Array<ChatMessagePart>, part: ChatToolPart) {
	const index = parts.findIndex(
		(current) => current.type === part.type && "toolCallId" in current && current.toolCallId === part.toolCallId,
	);

	if (index === -1) {
		const textIndex = parts.findIndex((current) => current.type === "text");
		if (textIndex === -1) return [...parts, part];

		return [...parts.slice(0, textIndex), part, ...parts.slice(textIndex)];
	}

	const next = [...parts];
	next[index] = { ...next[index], ...part };
	return next;
}

export function upsertPayloadPart(parts: Array<ChatMessagePart>, part: ChatPayloadPart) {
	const index = parts.findIndex(
		(current) =>
			current.type === "payload" &&
			(current.id && part.id ? current.id === part.id : current.kind === part.kind && current.title === part.title),
	);

	if (index === -1) return [...parts, part];

	const next = [...parts];
	next[index] = { ...next[index], ...part };
	return next;
}

export function createFleetReasoningPart({
	messageId,
	presentation,
}: {
	messageId: string;
	presentation: ChatReasoningPresentation;
}): ChatToolPart {
	return {
		type: "tool-FleetReasoning",
		toolCallId: `${messageId}-reasoning`,
		state: presentation.streaming ? "input-streaming" : "output-available",
		input: presentation,
	};
}

export function appendAssistantDelta(messages: Array<ChatMessage>, assistantId: string, delta: string) {
	return messages.map((message) => {
		if (message.id !== assistantId) return message;
		return { ...message, parts: appendTextPart(message.parts, delta) };
	});
}

export function upsertAssistantToolPart(messages: Array<ChatMessage>, assistantId: string, toolPart: ChatToolPart) {
	return messages.map((message) => {
		if (message.id !== assistantId) return message;
		return { ...message, parts: upsertToolPart(message.parts, toolPart) };
	});
}

export function upsertAssistantPayloadPart(
	messages: Array<ChatMessage>,
	assistantId: string,
	payloadPart: ChatPayloadPart,
) {
	return messages.map((message) => {
		if (message.id !== assistantId) return message;
		return { ...message, parts: upsertPayloadPart(message.parts, payloadPart) };
	});
}

export function upsertAssistantReasoningPresentation(
	messages: Array<ChatMessage>,
	assistantId: string,
	presentation: ChatReasoningPresentation,
) {
	return upsertAssistantToolPart(
		messages,
		assistantId,
		createFleetReasoningPart({ messageId: assistantId, presentation }),
	);
}

/** Remove legacy detailed-thinking parts received from an older adapter or persisted transcript. */
export function stripLegacyThinkingParts(message: ChatMessage): ChatMessage {
	if (message.role !== "assistant") return message;
	const parts = message.parts.filter((part) => part.type !== "tool-Thinking");
	return parts.length === message.parts.length ? message : { ...message, parts };
}

export function assistantTextFromMessage(message: ChatMessage): string {
	return message.parts
		.filter((part): part is Extract<ChatMessagePart, { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("");
}
