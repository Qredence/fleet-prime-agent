import { ProjectListResponseSchema } from "@prime-agent/web-protocol";
import { ChatSessionsResponseSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleChatSessionsGet } from "../handlers/chat-sessions";
import { handleProjectsGet } from "../handlers/projects";
import type { BridgeSession, PrimeBridge } from "../prime-bridge";
import { resetBridgeForTests, setBridgeForTests } from "../singleton";

const legacySession = {
	id: "legacy-session",
	cwd: process.cwd(),
	name: "Legacy session",
	created: new Date("2026-08-27T00:00:00.000Z"),
	modified: new Date("2026-08-27T00:01:00.000Z"),
	messageCount: 2,
	firstMessage: "Continue this session",
	state: { status: "active" },
};

function installLegacyBridge(): void {
	setBridgeForTests({
		listSessions: vi.fn(async () => [legacySession]),
		getSession: vi.fn(() => undefined),
		resetForTests: vi.fn(),
	} as unknown as PrimeBridge);
}

afterEach(() => {
	resetBridgeForTests();
});

describe("session list handlers", () => {
	it("preserves the session contract for legacy id-only rows", async () => {
		installLegacyBridge();

		const response = await handleChatSessionsGet(new Request("http://localhost/api/chat/sessions"));

		expect(response.status).toBe(200);
		expect(ChatSessionsResponseSchema.parse(await response.json()).sessions[0]).toMatchObject({
			sessionId: "legacy-session",
			title: "Legacy session",
			createdAt: "2026-08-27T00:00:00.000Z",
			updatedAt: "2026-08-27T00:01:00.000Z",
			firstMessage: "Continue this session",
		});
	});

	it("preserves project session IDs for legacy id-only rows", async () => {
		installLegacyBridge();

		const response = await handleProjectsGet(new Request("http://localhost/api/projects"));

		expect(response.status).toBe(200);
		expect(ProjectListResponseSchema.parse(await response.json()).sessions[0]).toMatchObject({
			sessionId: "legacy-session",
			title: "Legacy session",
			createdAt: "2026-08-27T00:00:00.000Z",
			updatedAt: "2026-08-27T00:01:00.000Z",
			firstMessage: "Continue this session",
		});
	});

	it("keeps live session status lookup keyed by the normalized ID", async () => {
		const liveSession = {
			sessionId: "legacy-session",
			session: { isStreaming: true },
		} as unknown as BridgeSession;
		const getSession = vi.fn(() => liveSession);
		setBridgeForTests({
			listSessions: vi.fn(async () => [legacySession]),
			getSession,
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);

		const response = await handleChatSessionsGet(new Request("http://localhost/api/chat/sessions"));

		expect(response.status).toBe(200);
		expect(ChatSessionsResponseSchema.parse(await response.json()).sessions[0]?.status).toBe("running");
		expect(getSession).toHaveBeenCalledWith("legacy-session");
	});

	it("prefers the persisted daemon session ID over its worker ID", async () => {
		setBridgeForTests({
			listSessions: vi.fn(async () => [
				{
					...legacySession,
					id: "daemon-worker-id",
					sessionId: "daemon-session-id",
					name: undefined,
					sessionName: "Daemon session",
					created: "2026-08-27T00:00:00.000Z",
					modified: "2026-08-27T00:01:00.000Z",
				},
			]),
			getSession: vi.fn(() => undefined),
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);

		const response = await handleChatSessionsGet(new Request("http://localhost/api/chat/sessions"));

		expect(response.status).toBe(200);
		expect(ChatSessionsResponseSchema.parse(await response.json()).sessions[0]).toMatchObject({
			sessionId: "daemon-session-id",
			title: "Daemon session",
		});
	});

	it("rejects a session row without a stable ID using a safe error", async () => {
		setBridgeForTests({
			listSessions: vi.fn(async () => [{ cwd: process.cwd(), firstMessage: "invalid" }]),
			getSession: vi.fn(() => undefined),
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);

		const response = await handleChatSessionsGet(new Request("http://localhost/api/chat/sessions"));
		const body = (await response.json()) as { message: string };

		expect(response.status).toBe(500);
		expect(body.message).toBe("The Prime Agent session listing returned an invalid session entry");
		expect(body.message).not.toContain(process.cwd());
	});
});
