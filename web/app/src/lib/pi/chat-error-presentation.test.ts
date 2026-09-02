import { getChatErrorPresentation } from "@prime-agent/web-design/components/product/fleet-pi/chat/chat-error-presentation";
import { NETWORK_DISCONNECTED_MESSAGE } from "@prime-agent/web-protocol/chat-protocol";
import { describe, expect, it } from "vitest";

describe("chat error presentation", () => {
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
});
