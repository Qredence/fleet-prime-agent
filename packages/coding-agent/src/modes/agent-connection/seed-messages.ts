import type { Message as PiAiMessage, UserMessage } from "@earendil-works/pi-ai";
import type { AgentConnectionSeedMessage } from "./types.js";

/** Convert a portable seed message into a SessionManager append shape. */
export function seedMessageToSessionMessage(seed: AgentConnectionSeedMessage): PiAiMessage {
	if (seed.role === "user") {
		return { role: "user", content: seed.text, timestamp: Date.now() } satisfies UserMessage;
	}
	return {
		role: "assistant",
		content: [{ type: "text", text: seed.text }],
		stopReason: "stop",
		timestamp: Date.now(),
	} as PiAiMessage;
}
