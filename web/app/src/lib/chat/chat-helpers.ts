import type { ComponentType } from "react";

import type {
	ChatModelInfo,
	ChatModelSelection,
	ChatReasoningPresentation,
	ChatThinkingLevel,
} from "@prime-agent/web-protocol/chat-protocol";
import { redactSessionLabelSecrets } from "@prime-agent/web-protocol/session-label";
import {
	type ChatMessage,
	type ChatMessagePart,
	type ChatPayloadPart,
	type ChatToolPart,
	isChatPayloadPart,
	isChatTextPart,
	isChatToolPart,
} from "@prime-agent/web-protocol/chat-types";

import type { CustomToolRendererProps, ModelOption } from "@/lib/chat/types";

export type ToolPartBase = {
	type: string;
	toolCallId?: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	result?: unknown;
};

export type ToolRendererProps = {
	part: ToolPartBase;
	nestedTools?: Array<ToolPartBase>;
	chatStatus?: string;
	toolRenderers?: Record<string, ComponentType<CustomToolRendererProps>>;
	insideTrace?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function isTextPart(part: unknown): part is { type: "text"; text: string } {
	return isRecord(part) && part.type === "text" && typeof part.text === "string";
}

export function isErrorPart(part: unknown): part is { type: "error"; title?: string; message: string } {
	return isRecord(part) && part.type === "error" && typeof part.message === "string";
}

export function isPayloadPart(part: unknown): part is {
	type: "payload";
	id?: string;
	kind: string;
	title: string;
	text?: string;
	payload?: unknown;
} {
	return (
		isRecord(part) &&
		part.type === "payload" &&
		typeof part.kind === "string" &&
		typeof part.title === "string" &&
		(part.id === undefined || typeof part.id === "string")
	);
}

export function isV5ToolPart(part: unknown): part is ToolPartBase {
	if (!isRecord(part)) return false;
	const partType = part.type;
	return partType === "dynamic-tool" || (typeof partType === "string" && partType.startsWith("tool-"));
}

type ToolQuestionPart = {
	type?: string;
	state?: string;
	output?: {
		answer?: unknown;
		answers?: Array<unknown>;
		content?: string;
		details?: unknown;
	};
};

export function isQuestionToolPartPending(part: ToolQuestionPart): boolean {
	if (part.type !== "tool-Question") return false;
	if (part.state === "output-available" || part.state === "output-error") return false;

	const output = part.output;
	if (!output) return true;
	if (output.answer !== undefined && output.answer !== null) return false;
	if (Array.isArray(output.answers) && output.answers.length > 0) return false;
	if (typeof output.content === "string" && output.content.length > 0) return false;

	return true;
}

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

function appendTextPart(parts: Array<ChatMessagePart>, delta: string): Array<ChatMessagePart> {
	const index = parts.findIndex(isChatTextPart);
	if (index === -1) return [...parts, { type: "text", text: delta }];

	const part = parts[index];
	if (!part || !isChatTextPart(part)) return parts;
	const next = [...parts];
	next[index] = { type: "text", text: `${part.text}${delta}` };
	return next;
}

export function upsertToolPart(parts: Array<ChatMessagePart>, part: ChatToolPart): Array<ChatMessagePart> {
	const index = parts.findIndex(
		(current) => isChatToolPart(current) && current.toolCallId === part.toolCallId && current.type === part.type,
	);

	if (index === -1) {
		const textIndex = parts.findIndex(isChatTextPart);
		if (textIndex === -1) return [...parts, part];

		return [...parts.slice(0, textIndex), part, ...parts.slice(textIndex)];
	}

	const existing = parts[index];
	const next = [...parts];
	next[index] = existing && isChatToolPart(existing) ? { ...existing, ...part } : part;
	return next;
}

function upsertPayloadPart(parts: Array<ChatMessagePart>, part: ChatPayloadPart): Array<ChatMessagePart> {
	const index = parts.findIndex(
		(current) =>
			isChatPayloadPart(current) &&
			(current.id && part.id ? current.id === part.id : current.kind === part.kind && current.title === part.title),
	);

	if (index === -1) return [...parts, part];

	const existing = parts[index];
	const next = [...parts];
	next[index] = existing && isChatPayloadPart(existing) ? { ...existing, ...part } : part;
	return next;
}

function createFleetReasoningPart({
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

export function applyAssistantReasoningText(
	messages: Array<ChatMessage>,
	assistantId: string,
	event: { phase: "start" | "delta" | "end"; text: string; contentIndex: number; durationMs?: number },
) {
	return messages.map((message) => {
		if (message.id !== assistantId) return message;
		let index = -1;
		let streamingIndex = -1;
		for (let i = 0; i < message.parts.length; i++) {
			const candidate = message.parts[i];
			if (candidate?.type !== "reasoning" || candidate.contentIndex !== event.contentIndex) continue;
			index = i;
			if (candidate.state === "streaming") streamingIndex = i;
		}
		if (streamingIndex >= 0) index = streamingIndex;
		else if (event.phase === "delta") index = -1;
		const existing = index < 0 ? undefined : message.parts[index];
		const openNewEpisode = event.phase === "start" && existing?.type === "reasoning" && existing.state === "complete";
		if (
			event.phase === "end" &&
			existing?.type === "reasoning" &&
			existing.state === "complete" &&
			streamingIndex < 0
		) {
			return message;
		}
		const previousText = !openNewEpisode && existing?.type === "reasoning" ? existing.text : "";
		const part = {
			type: "reasoning" as const,
			contentIndex: event.contentIndex,
			text:
				event.phase === "start"
					? event.text
					: event.phase === "delta"
						? previousText + event.text
						: event.phase === "end"
							? event.text || previousText
							: previousText,
			state: event.phase === "end" ? ("complete" as const) : ("streaming" as const),
			...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
		};
		const parts = [...message.parts];
		if (index >= 0 && !openNewEpisode) parts[index] = part;
		else {
			const emptyText = parts.findIndex((current) => current.type === "text" && !current.text);
			parts.splice(emptyText < 0 ? parts.length : emptyText, 0, part);
		}
		return { ...message, parts };
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

export type ChatModelOption = ModelOption & {
	provider: string;
	modelId: string;
	available?: boolean;
	reasoning?: boolean;
	thinkingLevel?: ChatModelInfo["defaultThinkingLevel"];
	thinkingLevels?: Array<ChatThinkingLevel>;
};

const ALL_THINKING_LEVELS: Array<ChatThinkingLevel> = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const THINKING_LEVEL_LABELS: Record<ChatThinkingLevel, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
};

export function thinkingLevelLabel(level: ChatThinkingLevel): string {
	return THINKING_LEVEL_LABELS[level];
}

export function availableThinkingLevels(
	model: Pick<ChatModelOption, "thinkingLevels" | "reasoning"> | undefined,
): Array<ChatThinkingLevel> {
	if (model?.thinkingLevels && model.thinkingLevels.length > 0) {
		return model.thinkingLevels;
	}
	if (model?.reasoning) return ALL_THINKING_LEVELS;
	return ["off"];
}

export function clampThinkingLevel(
	level: ChatThinkingLevel | undefined,
	available: Array<ChatThinkingLevel>,
): ChatThinkingLevel {
	if (level && available.includes(level)) return level;
	if (available.includes("medium")) return "medium";
	return available[0] ?? "off";
}

export function toModelOption(model: ChatModelInfo): ChatModelOption {
	return {
		id: model.key,
		name: model.name,
		provider: model.provider,
		modelId: model.id,
		available: model.available,
		reasoning: model.reasoning,
		thinkingLevel: model.defaultThinkingLevel,
		thinkingLevels: model.thinkingLevels,
	};
}

export function toModelSelection(
	model: ChatModelOption | undefined,
	thinkingLevel?: ChatThinkingLevel,
): ChatModelSelection | undefined {
	if (!model) return undefined;
	return {
		provider: model.provider,
		id: model.modelId,
		thinkingLevel: thinkingLevel ?? model.thinkingLevel,
	};
}

export function queueLabel(queue: { steering: Array<string>; followUp: Array<string> }) {
	const count = queue.followUp.length + queue.steering.length;
	if (count === 0) return undefined;
	if (queue.followUp.length > 0) {
		return `${queue.followUp.length} follow-up queued`;
	}
	return `${queue.steering.length} steering message queued`;
}

/** Sanitize a session label by trimming whitespace and removing exact half-string duplication. */
export function normalizeSessionLabel(label: string): string {
	const trimmed = redactSessionLabelSecrets(label).trim();
	if (trimmed.length === 0) return trimmed;
	const half = Math.floor(trimmed.length / 2);
	if (half > 0 && trimmed.slice(0, half) === trimmed.slice(half)) {
		return trimmed.slice(0, half);
	}
	return trimmed;
}

/** Detects a 403 Daytona-not-connected failure from chat/workspace APIs. */
export function isDaytonaNotConnectedError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	if (!(error instanceof Error)) return false;
	if (error.name !== "ChatRequestError") return false;
	return (error as { status?: unknown }).status === 403;
}
