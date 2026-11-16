import { NETWORK_DISCONNECTED_MESSAGE } from "@prime-agent/web-protocol/chat-protocol";
import { describe, expect, it, vi } from "vitest";
import { chatErrorEnvelope, isDaemonDisconnectError, safeErrorMessage, wrapApiHandler } from "../wrap-api-handler";
import { FleetErrorEnvelopeSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { COMPOSER_INTENT_COMMANDS } from "@prime-agent/web-protocol/composer-intent";

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

	it.each([
		{ message: "Invalid request" },
		{ ok: false, message: "Unknown session" },
		{ error: { code: "invalid_request", message: "Dashboard data failed." } },
		{ status: "error", error: "In Prime Agent, run /mcp login linear or /login to sign in." },
		{ code: "UNWRITABLE", message: "Change settings in the terminal." },
		{ code: "FUTURE_CODE", message: "Future error", remediation: { action: "unknown", label: "Unknown" } },
		{ code: "RATE_LIMIT", message: "Limited", provider: 123, remediation: "invalid" },
	])("normalizes explicit HTTP failures into a valid envelope: %j", async (body) => {
		const response = await wrapApiHandler(
			async () =>
				Response.json(body, {
					status: 409,
					headers: { "Retry-After": "5", "Content-Length": "999" },
				}),
			new Request("http://localhost/api/chat"),
		);
		const result = await response.json();
		expect(response.status).toBe(409);
		expect(FleetErrorEnvelopeSchema.safeParse(result).success).toBe(true);
		expect(response.headers.get("Retry-After")).toBe("5");
		expect(response.headers.has("Content-Length")).toBe(false);
		if ("ok" in body) expect(result.ok).toBe(false);
		if ("error" in body) expect(result.error).toEqual(body.error);
		if ("code" in body && body.code === "UNWRITABLE") expect(result.code).toBe("UNWRITABLE");
	});

	it("scrubs paths and secrets in explicit errors while retaining public terminal commands", async () => {
		const response = await wrapApiHandler(
			async () =>
				Response.json(
					{
						message: "Cannot read /tmp/private.json api_key=synthetic-secret; run /login",
					},
					{ status: 500 },
				),
			new Request("http://localhost/api/chat"),
		);
		const body = await response.json();
		expect(body.message).not.toContain("/tmp/private.json");
		expect(body.message).not.toContain("synthetic-secret");
		expect(body.message).toContain("/login");
		expect(safeErrorMessage("Cannot read /login/private or /mcp/private")).not.toContain("/private");
	});

	it.each(COMPOSER_INTENT_COMMANDS.map((command) => command.id))(
		"preserves /%s in explicit command guidance without exposing subpaths",
		async (command) => {
			const message = `/${command} requires an argument.`;
			const response = await wrapApiHandler(
				async () => Response.json({ message }, { status: 400 }),
				new Request("http://localhost/api/chat"),
			);
			expect((await response.json()).message).toBe(message);
			expect(safeErrorMessage(`Cannot read /${command}/private`)).not.toContain("/private");
		},
	);

	it("preserves public API guidance only in an HTTP-method context", () => {
		expect(safeErrorMessage("GET /api/chat/session requires ?sessionId=")).toBe(
			"GET /api/chat/session requires ?sessionId=",
		);
		expect(safeErrorMessage("Cannot read /api/private")).not.toContain("/api/private");
	});

	it("does not consume successful streams and normalizes non-JSON error bodies safely", async () => {
		const stream = new Response("stream", { headers: { "Content-Type": "application/x-ndjson" } });
		const request = new Request("http://localhost/api/chat");
		expect(await wrapApiHandler(async () => stream, request)).toBe(stream);
		expect(stream.bodyUsed).toBe(false);
		const error = await wrapApiHandler(
			async () => new Response("private server diagnostic", { status: 502 }),
			request,
		);
		expect(await error.json()).toEqual({ code: "UNKNOWN_ERROR", message: "Request failed (502)" });
		expect(error.headers.get("Content-Type")).toBe("application/json");
	});

	it("classifies daemon disconnects by message shape", () => {
		expect(isDaemonDisconnectError(DAEMON_DISCONNECT_ERROR)).toBe(true);
		expect(isDaemonDisconnectError(new Error("the Prime Agent daemon is not connected"))).toBe(true);
		expect(isDaemonDisconnectError(new Error("Project no longer exists"))).toBe(false);
		expect(chatErrorEnvelope(new Error("boom")).code).toBe("UNKNOWN_ERROR");
	});
});
