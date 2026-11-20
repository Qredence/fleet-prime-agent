import { NETWORK_DISCONNECTED_MESSAGE } from "@prime-agent/web-protocol/chat-protocol";

import { isDaemonDisconnectError } from "@/lib/chat/chat-fetch";
import { notify } from "@/lib/notify";

function stripDaemonDiagnostics(message: string): string {
	const match = message.match(/\s(?:Socket|Daemon log):\s/i);
	if (!match || match.index === undefined) return message;
	return message.slice(0, match.index).trimEnd();
}

/**
 * Maps a chat error to a user-facing title and message.
 */
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

/**
 * Daemon-disconnect failures already render in the chat panel error state;
 * toasting them would duplicate the message with raw transport detail.
 */
export function notifyChatError(error: unknown): void {
	if (isDaemonDisconnectError(error)) return;
	notify.error(error instanceof Error ? error.message : String(error));
}

/**
 * Runs a workspace chrome action and surfaces failures instead of a silent no-op.
 */
export function runWorkspaceAction(action: () => Promise<unknown>): void {
	void Promise.resolve().then(action).catch(notifyChatError);
}
