import type { ChatStreamEvent } from "@prime-agent/web-protocol/chat-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleChatEventsGet } from "../handlers/chat-events";
import type { PrimeBridge, RlmChildStream } from "../prime-bridge";
import { resetBridgeForTests, setBridgeForTests } from "../singleton";

const emptyPresentation = {
	revision: 0,
	userBash: [],
	rlmChildren: [],
	refinements: [],
	artifactRuns: [],
};

function bridgeWith(overrides: Partial<PrimeBridge>): PrimeBridge {
	return {
		addEventListener: vi.fn(() => () => undefined),
		pendingDialogsFor: vi.fn(() => []),
		replaySince: vi.fn(() => ({ replayed: [], overflowed: false })),
		resetForTests: vi.fn(),
		...overrides,
	} as unknown as PrimeBridge;
}

afterEach(() => {
	resetBridgeForTests();
});

describe("handleChatEventsGet child streams", () => {
	it("validates child query shape and opaque identifiers before opening a watcher", async () => {
		const openRlmChildStream = vi.fn();
		setBridgeForTests(bridgeWith({ openRlmChildStream }));

		const incomplete = await handleChatEventsGet(
			new Request("http://localhost/api/chat/events?parentSessionId=parent-session"),
		);
		const invalid = await handleChatEventsGet(
			new Request("http://localhost/api/chat/events?parentSessionId=../private&childId=child-1"),
		);
		const mixed = await handleChatEventsGet(
			new Request(
				"http://localhost/api/chat/events?sessionId=root-session&parentSessionId=parent-session&childId=child-1",
			),
		);
		const invalidGeneration = await handleChatEventsGet(
			new Request(
				"http://localhost/api/chat/events?parentSessionId=parent-session&childId=child-1&streamGeneration=bad%20generation",
			),
		);

		expect(incomplete.status).toBe(400);
		expect(invalid.status).toBe(400);
		expect(mixed.status).toBe(400);
		expect(invalidGeneration.status).toBe(400);
		expect(openRlmChildStream).not.toHaveBeenCalled();
	});

	it("sends a snapshot before replay and releases the watcher when the client closes", async () => {
		const release = vi.fn(async () => undefined);
		const snapshot: Extract<ChatStreamEvent, { type: "session_snapshot" }> = {
			type: "session_snapshot",
			session: { sessionId: "child-runtime" },
			messages: [],
			presentation: emptyPresentation,
			status: "streaming",
		};
		const childStream: RlmChildStream = {
			sessionId: "child-runtime",
			projectId: null,
			snapshot,
			channelId: "child-channel",
			streamGeneration: "generation-1",
			mode: "live",
			resumeAccepted: false,
			cursorReset: false,
			replayFrom: 0,
			includeSnapshot: true,
			release,
		};
		const bridge = bridgeWith({ openRlmChildStream: vi.fn(async () => childStream) });
		setBridgeForTests(bridge);

		const response = await handleChatEventsGet(
			new Request("http://localhost/api/chat/events?parentSessionId=parent-session&childId=child-1"),
		);
		expect(response.status).toBe(200);

		const reader = response.body?.getReader();
		expect(reader).toBeDefined();
		let body = "";
		for (let index = 0; index < 2 && !body.includes('"type":"session_snapshot"'); index += 1) {
			const chunk = await reader!.read();
			body += new TextDecoder().decode(chunk.value);
		}
		expect(body).toContain('"type":"connected"');
		expect(body).toContain('"type":"session_snapshot"');
		expect(body).toContain('"streamGeneration":"generation-1"');

		await reader!.cancel();
		expect(release).toHaveBeenCalledOnce();
	});

	it("passes the generation and cursor to child stream resumption", async () => {
		const release = vi.fn(async () => undefined);
		const childStream: RlmChildStream = {
			sessionId: "child-runtime",
			projectId: null,
			snapshot: {
				type: "session_snapshot",
				session: { sessionId: "child-runtime" },
				messages: [],
				presentation: emptyPresentation,
				status: "streaming",
			},
			channelId: "child-channel",
			streamGeneration: "generation-2",
			mode: "live",
			resumeAccepted: true,
			cursorReset: false,
			replayFrom: 41,
			includeSnapshot: false,
			release,
		};
		const openRlmChildStream = vi.fn(async () => childStream);
		setBridgeForTests(bridgeWith({ openRlmChildStream }));

		const response = await handleChatEventsGet(
			new Request(
				"http://localhost/api/chat/events?parentSessionId=parent-session&childId=child-1&streamGeneration=generation-2&lastEventId=41",
			),
		);
		expect(response.status).toBe(200);
		expect(openRlmChildStream).toHaveBeenCalledWith("parent-session", "child-1", {
			streamGeneration: "generation-2",
			lastEventId: 41,
		});

		const reader = response.body?.getReader();
		expect(reader).toBeDefined();
		const first = await reader!.read();
		const body = new TextDecoder().decode(first.value);
		expect(body).toContain('"resumeAccepted":true');
		expect(body).not.toContain('"type":"session_snapshot"');
		await reader!.cancel();
		expect(release).toHaveBeenCalledOnce();
	});

	it("closes snapshot-only terminal child streams after the initial snapshot", async () => {
		const release = vi.fn(async () => undefined);
		const childStream: RlmChildStream = {
			sessionId: "child-runtime",
			projectId: null,
			snapshot: {
				type: "session_snapshot",
				session: { sessionId: "child-runtime" },
				messages: [],
				presentation: emptyPresentation,
				status: "ready",
				terminal: true,
			},
			channelId: "snapshot-channel",
			streamGeneration: "generation-terminal",
			mode: "snapshot-only",
			resumeAccepted: false,
			cursorReset: true,
			replayFrom: 0,
			includeSnapshot: true,
			release,
		};
		setBridgeForTests(bridgeWith({ openRlmChildStream: vi.fn(async () => childStream) }));

		const response = await handleChatEventsGet(
			new Request("http://localhost/api/chat/events?parentSessionId=parent-session&childId=child-1&lastEventId=12"),
		);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('"terminal":true');
		expect(body).toContain('"cursorReset":true');
		expect(release).toHaveBeenCalledOnce();
	});

	it("keeps unknown children out of the child stream", async () => {
		const openRlmChildStream = vi.fn(async () => undefined);
		setBridgeForTests(bridgeWith({ openRlmChildStream }));

		const response = await handleChatEventsGet(
			new Request("http://localhost/api/chat/events?parentSessionId=parent-session&childId=child-1"),
		);

		expect(response.status).toBe(404);
		expect(openRlmChildStream).toHaveBeenCalledWith("parent-session", "child-1", {
			lastEventId: 0,
		});
	});
});
