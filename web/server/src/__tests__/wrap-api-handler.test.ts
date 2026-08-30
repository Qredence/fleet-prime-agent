import { NETWORK_DISCONNECTED_MESSAGE } from "@prime-agent/web-protocol/chat-protocol";
import { describe, expect, it } from "vitest";
import { chatErrorEnvelope, isDaemonDisconnectError, wrapApiHandler } from "../wrap-api-handler";

const DAEMON_DISCONNECT_ERROR = new Error(
	'Cannot send daemon command "get_messages" because the Prime Agent daemon is not connected. Socket: /tmp/prime.sock Daemon log: /Users/example/prime.log',
);

describe("wrapApiHandler", () => {
	it("maps daemon transport failures to the typed NETWORK_DISCONNECTED envelope", async () => {
		const response = await wrapApiHandler(async () => {
			throw DAEMON_DISCONNECT_ERROR;
		});

		expect(response.status).toBe(500);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body.code).toBe("NETWORK_DISCONNECTED");
		expect(body.message).toBe(NETWORK_DISCONNECTED_MESSAGE);
		expect(body.remediation).toEqual({ action: "reconnect", label: "Reconnect runtime" });
		expect(JSON.stringify(body)).not.toContain("/tmp/prime.sock");
		expect(JSON.stringify(body)).not.toContain("/Users/example");
	});

	it("keeps ordinary failures as UNKNOWN_ERROR with scrubbed messages", async () => {
		const response = await wrapApiHandler(async () => {
			throw new Error("Failed to read /Users/example/secret.json");
		});

		expect(response.status).toBe(500);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body.code).toBe("UNKNOWN_ERROR");
		expect(typeof body.message).toBe("string");
		expect(JSON.stringify(body)).not.toContain("/Users/example");
	});

	it("preserves handler status codes", async () => {
		const response = await wrapApiHandler(async () => {
			throw Object.assign(new Error("Session belongs to another user"), { status: 403 });
		});

		expect(response.status).toBe(403);
	});

	it("classifies daemon disconnects by message shape", () => {
		expect(isDaemonDisconnectError(DAEMON_DISCONNECT_ERROR)).toBe(true);
		expect(isDaemonDisconnectError(new Error("the Prime Agent daemon is not connected"))).toBe(true);
		expect(isDaemonDisconnectError(new Error("Project no longer exists"))).toBe(false);
		expect(chatErrorEnvelope(new Error("boom")).code).toBe("UNKNOWN_ERROR");
	});
});
