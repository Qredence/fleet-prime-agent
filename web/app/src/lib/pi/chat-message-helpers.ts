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

export function thinkingTextFromPart(part: ChatMessagePart): string {
	if (part.type !== "tool-Thinking") return "";
	if (part.input && typeof part.input === "object") {
		const rec = part.input as Record<string, unknown>;
		if (typeof rec.thought === "string") return rec.thought;
		if (typeof rec.text === "string") return rec.text;
	}
	if (typeof part.output === "string") return part.output;
	if (part.output && typeof part.output === "object") {
		const rec = part.output as Record<string, unknown>;
		if (typeof rec.thought === "string") return rec.thought;
		if (typeof rec.text === "string") return rec.text;
	}
	return "";
}

export function assistantTextFromMessage(message: ChatMessage): string {
	return message.parts
		.filter((part): part is Extract<ChatMessagePart, { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("");
}

/**
 * Models that emit only `thinking_delta` (no `text_delta`) would otherwise
 * leave the user with a Thought fold and no assistant bubble. Promote that
 * thinking into a text part when the turn has no visible answer.
 */
export function promoteThinkingToAssistantText(message: ChatMessage): ChatMessage {
	if (message.role !== "assistant") return message;
	if (assistantTextFromMessage(message).trim()) return message;
	const thinking = message.parts.map(thinkingTextFromPart).join("");
	if (!thinking.trim()) return message;
	const tools = message.parts.filter((part) => part.type !== "text" && part.type !== "tool-Thinking");
	return {
		...message,
		parts: [{ type: "text", text: thinking }, ...tools],
	};
}

export function upsertAssistantThinkingPart(messages: Array<ChatMessage>, assistantId: string, thought: string) {
	return messages.map((message) => {
		if (message.id !== assistantId) return message;
		const existing = message.parts.find((part) => part.type === "tool-Thinking");
		const previous = existing ? thinkingTextFromPart(existing) : "";
		return {
			...message,
			parts: upsertToolPart(
				message.parts,
				createThinkingToolPart({
					messageId: assistantId,
					thought: `${previous}${thought}`,
				}),
			),
		};
	});
}
