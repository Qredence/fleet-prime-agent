import { notify } from "@prime-agent/web-design/lib/notify";
import { NETWORK_DISCONNECTED_MESSAGE } from "@prime-agent/web-protocol/chat-protocol";
import { describe, expect, it, vi } from "vitest";
import { notifyChatError } from "./chat-error-notify";
import { ChatRequestError, chatErrorFromStreamEvent, isDaemonDisconnectError } from "./chat-fetch";

vi.mock("@prime-agent/web-design/lib/notify", () => ({
	notify: {
		error: vi.fn(),
		message: vi.fn(),
		success: vi.fn(),
	},
}));

const notifyError = vi.mocked(notify.error);

describe("notifyChatError", () => {
	it("skips toasts for typed daemon disconnect envelopes", () => {
		const error = new ChatRequestError(
			500,
			JSON.stringify({
				code: "NETWORK_DISCONNECTED",
				message: NETWORK_DISCONNECTED_MESSAGE,
				remediation: { action: "reconnect", label: "Reconnect runtime" },
			}),
		);

		expect(error.code).toBe("NETWORK_DISCONNECTED");
		expect(error.remediation?.action).toBe("reconnect");
		expect(error.message).toBe(NETWORK_DISCONNECTED_MESSAGE);
		notifyChatError(error);
		expect(notifyError).not.toHaveBeenCalled();
	});

	it("skips toasts for legacy raw daemon transport messages", () => {
		notifyChatError(
			new Error(
				'Cannot send daemon command "get_messages" because the Prime Agent daemon is not connected. Socket: /tmp/private.sock',
			),
		);
		expect(notifyError).not.toHaveBeenCalled();
	});

	it("skips toasts for stream errors that carry the disconnect code", () => {
		const error = chatErrorFromStreamEvent({
			message: "runtime went away",
			code: "NETWORK_DISCONNECTED",
		});

		expect(isDaemonDisconnectError(error)).toBe(true);
		notifyChatError(error);
		expect(notifyError).not.toHaveBeenCalled();
	});

	it("toasts ordinary failures with their message", () => {
		notifyChatError(new Error("Project no longer exists"));
		expect(notifyError).toHaveBeenCalledWith("Project no longer exists");
	});
});
