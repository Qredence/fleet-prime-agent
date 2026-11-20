import { NETWORK_DISCONNECTED_MESSAGE } from "@prime-agent/web-protocol/chat-protocol";
import { describe, expect, it, vi } from "vitest";
import { getChatErrorPresentation, notifyChatError, runWorkspaceAction } from "@/lib/chat/chat-error-notify";
import { ChatRequestError, chatErrorFromStreamEvent, isDaemonDisconnectError } from "@/lib/chat/chat-fetch";
import { notify } from "@/lib/notify";

vi.mock("@/lib/notify", () => ({
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

	it("surfaces rejected workspace chrome actions", async () => {
		runWorkspaceAction(async () => {
			throw new Error("Unable to create session");
		});
		await vi.waitFor(() => expect(notifyError).toHaveBeenCalledWith("Unable to create session"));
	});

	it("surfaces synchronous workspace chrome action failures", async () => {
		runWorkspaceAction(() => {
			throw new Error("Unable to open workspace");
		});
		await vi.waitFor(() => expect(notifyError).toHaveBeenCalledWith("Unable to open workspace"));
	});
});

describe("getChatErrorPresentation", () => {
	it("turns daemon transport details into a useful runtime message", () => {
		const presentation = getChatErrorPresentation(
			new Error(
				'Cannot send daemon command "get_messages" because the Prime Agent daemon is not connected. Socket: /tmp/private.sock Daemon log: /Users/example/private.log',
			),
		);

		expect(presentation).toEqual({
			title: "Agent unavailable",
			message: NETWORK_DISCONNECTED_MESSAGE,
		});
		expect(JSON.stringify(presentation)).not.toContain("/tmp/private.sock");
		expect(JSON.stringify(presentation)).not.toContain("/Users/example");
	});

	it("recognizes typed NETWORK_DISCONNECTED errors from the server envelope", () => {
		const error = Object.assign(new Error(NETWORK_DISCONNECTED_MESSAGE), {
			code: "NETWORK_DISCONNECTED",
		});

		expect(getChatErrorPresentation(error)).toEqual({
			title: "Agent unavailable",
			message: NETWORK_DISCONNECTED_MESSAGE,
		});
	});

	it("recognizes the canonical disconnected message even without a typed code", () => {
		expect(getChatErrorPresentation(new Error(NETWORK_DISCONNECTED_MESSAGE))).toEqual({
			title: "Agent unavailable",
			message: NETWORK_DISCONNECTED_MESSAGE,
		});
	});

	it("preserves ordinary request failures", () => {
		expect(getChatErrorPresentation(new Error("Project no longer exists"))).toEqual({
			title: "Request failed",
			message: "Project no longer exists",
		});
	});

	it("strips daemon diagnostics from generic request failures without lowercasing offsets", () => {
		const presentation = getChatErrorPresentation(new Error("Upstream failed Socket: /tmp/private.sock"));
		expect(presentation.message).toBe("Upstream failed");
		expect(presentation.message).not.toContain("/tmp/private.sock");
	});
});
