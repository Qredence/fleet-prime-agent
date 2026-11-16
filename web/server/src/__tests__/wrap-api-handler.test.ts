import { NETWORK_DISCONNECTED_MESSAGE } from "@prime-agent/web-protocol/chat-protocol";
import { describe, expect, it, vi } from "vitest";
import { chatErrorEnvelope, isDaemonDisconnectError, wrapApiHandler } from "../wrap-api-handler";

const DAEMON_DISCONNECT_ERROR = new Error(
	'Cannot send daemon command "get_messages" because the Prime Agent daemon is not connected. Socket: /tmp/prime.sock Daemon log: /Users/example/prime.log',
);

describe("wrapApiHandler", () => {
	it("maps daemon transport failures to the typed NETWORK_DISCONNECTED envelope", async () => {
		const response = await wrapApiHandler(async () => {
			throw DAEMON_DISCONNECT_ERROR;
		}, new Request("http://localhost/api/chat"));

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
		}, new Request("http://localhost/api/chat"));

		expect(response.status).toBe(500);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body.code).toBe("UNKNOWN_ERROR");
		expect(typeof body.message).toBe("string");
		expect(JSON.stringify(body)).not.toContain("/Users/example");
	});

	it("preserves handler status codes", async () => {
		const response = await wrapApiHandler(async () => {
			throw Object.assign(new Error("Session belongs to another user"), { status: 403 });
		}, new Request("http://localhost/api/chat"));

		expect(response.status).toBe(403);
	});

	it.each(["POST", "PATCH", "DELETE", "PUT"])(
		"rejects cross-origin %s before executing the handler",
		async (method) => {
			const handler = vi.fn(async () => Response.json({ ok: true }));
			const request = new Request("http://localhost/api/chat", {
				method,
				headers: { Origin: "https://untrusted.example" },
			});
			const response = await wrapApiHandler(handler, request);
			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({ message: "Cross-origin request rejected." });
			expect(handler).not.toHaveBeenCalled();
		},
	);

	it.each(["null", "not an origin"])("rejects malformed mutation origin %s", async (origin) => {
		const handler = vi.fn(async () => Response.json({ ok: true }));
		const response = await wrapApiHandler(
			handler,
			new Request("http://localhost/api/chat", {
				method: "POST",
				headers: { Origin: origin },
			}),
		);
		expect(response.status).toBe(403);
		expect(handler).not.toHaveBeenCalled();
	});

	it.each([
		["POST", undefined],
		["POST", "https://fleet.example"],
		["POST", "http://localhost:3000"],
		["POST", "http://127.0.0.1:3000"],
		["GET", "https://untrusted.example"],
	])("preserves the origin policy for %s from %s", async (method, origin) => {
		const handler = vi.fn(async () => Response.json({ ok: true }));
		const response = await wrapApiHandler(
			handler,
			new Request("https://fleet.example/api/chat", {
				method,
				headers: origin ? { Origin: origin } : {},
			}),
		);
		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalledOnce();
	});

	it("classifies daemon disconnects by message shape", () => {
		expect(isDaemonDisconnectError(DAEMON_DISCONNECT_ERROR)).toBe(true);
		expect(isDaemonDisconnectError(new Error("the Prime Agent daemon is not connected"))).toBe(true);
		expect(isDaemonDisconnectError(new Error("Project no longer exists"))).toBe(false);
		expect(chatErrorEnvelope(new Error("boom")).code).toBe("UNKNOWN_ERROR");
	});
});
