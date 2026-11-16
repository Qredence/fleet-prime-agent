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
