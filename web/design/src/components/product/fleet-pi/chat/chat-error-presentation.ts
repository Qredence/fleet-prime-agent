import { NETWORK_DISCONNECTED_MESSAGE } from "@prime-agent/web-protocol/chat-protocol";

export function getChatErrorPresentation(error: Error) {
	if (
		(error as { code?: unknown }).code === "NETWORK_DISCONNECTED" ||
		/Cannot send daemon command/i.test(error.message) ||
		/Prime Agent daemon is not connected/i.test(error.message) ||
		/not connected to the Prime Agent runtime/i.test(error.message)
	) {
		return {
			title: "Agent unavailable",
			message: NETWORK_DISCONNECTED_MESSAGE,
		};
	}

	return {
		title: "Request failed",
		message: error.message.replace(/\s+(?:Socket|Daemon log):\s*[^\n]*(?:\s+(?:Socket|Daemon log):\s*[^\n]*)*/gi, ""),
	};
}
