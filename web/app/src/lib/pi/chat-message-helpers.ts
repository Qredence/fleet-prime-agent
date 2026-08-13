import type { ChatMessage, ChatMessagePart, ChatToolPart } from "@prime-agent/web-protocol/chat-types";

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

export function buildThinkingToolCallId(messageId: string, index = 0) {
	return `${messageId}-thinking-${index}`;
}

export function createThinkingToolPart({
	messageId,
	thought,
	index = 0,
	state = "input-streaming",
}: {
	messageId: string;
	thought: string;
	index?: number;
	state?: string;
}): ChatToolPart {
	return {
		type: "tool-Thinking",
		toolCallId: buildThinkingToolCallId(messageId, index),
		state,
		input: { thought },
		output: thought,
	};
}

export function upsertThinkingPart(
	parts: Array<ChatMessagePart>,
	messageId: string,
	thought: string,
	options?: {
		index?: number;
		state?: string;
	},
) {
	return upsertToolPart(
		parts,
		createThinkingToolPart({
			messageId,
			thought,
			index: options?.index,
			state: options?.state,
		}),
	);
}

export function finalizeThinkingToolParts(parts: Array<ChatMessagePart>) {
	return parts.map((part) => {
		if (part.type !== "tool-Thinking" || part.state !== "input-streaming") {
			return part;
		}

		return {
			...part,
			state: "output-available",
		};
	});
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

export function upsertAssistantThinkingPart(messages: Array<ChatMessage>, assistantId: string, thought: string) {
	return upsertAssistantToolPart(
		messages,
		assistantId,
		createThinkingToolPart({
			messageId: assistantId,
			thought,
		}),
	);
}
