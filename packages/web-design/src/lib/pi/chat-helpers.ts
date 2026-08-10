import type { ChatModelInfo, ChatModelSelection } from "@prime-agent/web-protocol/chat-protocol";
import { Bot, ClipboardList, Hammer } from "lucide-react";
import type { ModelOption } from "../../components/agent-elements/types";

export type ChatModelOption = ModelOption & {
	provider: string;
	modelId: string;
	available?: boolean;
	reasoning?: boolean;
	thinkingLevel?: ChatModelInfo["defaultThinkingLevel"];
};

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
	};
}

export function toModelSelection(model: ChatModelOption | undefined): ChatModelSelection | undefined {
	if (!model) return undefined;
	return {
		provider: model.provider,
		id: model.modelId,
		thinkingLevel: model.thinkingLevel,
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
	const trimmed = label.trim();
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
