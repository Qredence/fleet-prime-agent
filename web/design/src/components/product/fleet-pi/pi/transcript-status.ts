import type { PrimeAgentRlmChild } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types";

/**
 * Maps a subagent's lifecycle state to the corresponding chat status.
 *
 * @param child - The subagent whose status determines the chat status
 * @returns `streaming` for running or recovering subagents, `error` for failed subagents, and `ready` otherwise
 */
export function transcriptStatus(child: PrimeAgentRlmChild): ChatStatus {
	if (child.status === "running" || child.status === "recovering") return "streaming";
	if (child.status === "error" || child.status === "failed") return "error";
	return "ready";
}
