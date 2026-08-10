import type { ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol";

export type ConfigModelInfo = {
	id: string;
	name: string;
	provider: string;
	modelId: string;
	version?: string;
	reasoning?: boolean;
	available?: boolean;
	thinkingLevel?: ChatThinkingLevel;
};

export type ProviderSummary = {
	active: number;
	available: number;
	provider: string;
	total: number;
};
