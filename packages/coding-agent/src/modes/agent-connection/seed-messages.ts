import type { Api, AssistantMessage, Message as PiAiMessage, Provider, UserMessage } from "@earendil-works/pi-ai";
import { emptyUsage } from "../../core/usage.js";
import type { AgentConnectionSeedMessage } from "./types.js";

export interface SeedAssistantModel {
	api: Api;
	provider: Provider;
	id: string;
}

const SEEDED_ASSISTANT_FALLBACK = {
	api: "openai-completions",
	provider: "openai",
	id: "seeded",
} as const satisfies SeedAssistantModel;

/** Convert a portable seed message into a SessionManager append shape. */
export function seedMessageToSessionMessage(seed: AgentConnectionSeedMessage, model?: SeedAssistantModel): PiAiMessage {
	if (seed.role === "user") {
		return { role: "user", content: seed.text, timestamp: Date.now() } satisfies UserMessage;
	}
	const resolved = model ?? SEEDED_ASSISTANT_FALLBACK;
	return {
		role: "assistant",
		content: [{ type: "text", text: seed.text }],
		api: resolved.api,
		provider: resolved.provider,
		model: resolved.id,
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	} satisfies AssistantMessage;
}
