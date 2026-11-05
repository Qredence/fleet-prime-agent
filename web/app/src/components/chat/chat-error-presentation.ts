import { NETWORK_DISCONNECTED_MESSAGE } from "@prime-agent/web-protocol/chat-protocol";

/**
 * Maps a chat error to a user-facing title and message.
 *
 * @param error - The error to present.
 * @returns An object containing the presentation title and message.
 */
function stripDaemonDiagnostics(message: string): string {
	const lower = message.toLowerCase();
	let cut = message.length;
	for (const marker of ["socket:", "daemon log:"]) {
		let from = 0;
		while (from < lower.length) {
			const at = lower.indexOf(marker, from);
			if (at === -1) break;
			const after = at + marker.length;
			if (at > 0 && message.charCodeAt(at - 1) <= 32 && after < message.length && message.charCodeAt(after) <= 32) {
				let start = at;
				while (start > 0 && message.charCodeAt(start - 1) <= 32) start -= 1;
				if (start < cut) cut = start;
				break;
			}
			from = at + 1;
		}
	}
	return cut === message.length ? message : message.slice(0, cut);
}

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
		message: stripDaemonDiagnostics(error.message),
	};
}
