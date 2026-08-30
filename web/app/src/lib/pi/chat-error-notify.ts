import { notify } from "@prime-agent/web-design/lib/notify";
import { isDaemonDisconnectError } from "./chat-fetch";

/**
 * Daemon-disconnect failures already render in the chat panel error state;
 * toasting them would duplicate the message with raw transport detail.
 */
export function notifyChatError(error: unknown): void {
	if (isDaemonDisconnectError(error)) return;
	notify.error(error instanceof Error ? error.message : String(error));
}
