import type { ChatModelInfo, ChatModelSelection, ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol";
import { redactSessionLabelSecrets } from "@prime-agent/web-protocol/session-label";
import { Bot, ClipboardList, Hammer } from "lucide-react";
import type { ModelOption } from "../../components/registry/beui/agents/types";

export type ChatModelOption = ModelOption & {
	provider: string;
	modelId: string;
	available?: boolean;
	reasoning?: boolean;
	thinkingLevel?: ChatModelInfo["defaultThinkingLevel"];
	thinkingLevels?: Array<ChatThinkingLevel>;
};

export const ALL_THINKING_LEVELS: Array<ChatThinkingLevel> = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

export const THINKING_LEVEL_LABELS: Record<ChatThinkingLevel, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
};

export const THINKING_LEVEL_DESCRIPTIONS: Record<ChatThinkingLevel, string> = {
	off: "No reasoning",
	minimal: "Very brief reasoning",
	low: "Light reasoning",
	medium: "Moderate reasoning",
	high: "Deep reasoning",
	xhigh: "Very deep reasoning",
	max: "Maximum reasoning",
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

export const CHAT_MODES = [
	{
		id: "agent",
		label: "Agent",
		icon: Bot,
		description: "Full tool access",
	},
	{
		id: "plan",
		label: "Plan",
		icon: ClipboardList,
		description: "Read-only planning",
	},
	{
		id: "harness",
		label: "Harness",
		icon: Hammer,
		description: "Workspace architecture",
	},
];

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

/**
 * Sanitize a session label by trimming whitespace and removing exact
 * half-string duplication (e.g. "abcabc" → "abc").
 */
export function normalizeSessionLabel(label: string): string {
	const trimmed = redactSessionLabelSecrets(label).trim();
	if (trimmed.length === 0) return trimmed;
	const half = Math.floor(trimmed.length / 2);
	if (half > 0 && trimmed.slice(0, half) === trimmed.slice(half)) {
		return trimmed.slice(0, half);
	}
	return trimmed;
}

/**
 * Detects a 403 "Daytona not connected" failure from the chat/workspace APIs.
 * The server throws `DaytonaCredentialRequiredError` (status 403) when a
 * deployed user has no Daytona BYOK key, and the typed client surfaces it as a
 * `ChatRequestError` with `status === 403`. This helper lets UI surfaces render
 * a friendly disconnected state instead of the raw `daytona_credential_required`
 * message. It is structurally typed so hax-design need not import the app layer.
 */
export function isDaytonaNotConnectedError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	if (!(error instanceof Error)) return false;
	if (error.name !== "ChatRequestError") return false;
	return (error as { status?: unknown }).status === 403;
}
