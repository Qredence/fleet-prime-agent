import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ candidates: [] as Array<{ text: string; at: number }> }));

vi.mock("../completion/singleton", () => ({
	getPromptIndex: () => ({
		candidates: () => mocks.candidates,
		ready: async () => {},
		refresh: async () => {},
		stats: () => ({ sessions: 0, prompts: mocks.candidates.length, builtAt: 0 }),
	}),
}));

import { handleChatCompletionPost } from "../handlers/chat-completion";

function post(body: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/chat/completion", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		...init,
	});
}

describe("handleChatCompletionPost", () => {
	it("returns a completion for a matching prefix", async () => {
		mocks.candidates = [{ text: "refactor the auth middleware and add tests", at: 1 }];
		const response = await handleChatCompletionPost(post({ text: "refactor the auth mid" }));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ completion: "refactor the auth middleware and add tests" });
	});

	it("returns an empty body when nothing matches", async () => {
		mocks.candidates = [{ text: "run the tests", at: 1 }];
		const response = await handleChatCompletionPost(post({ text: "something else entirely" }));
		expect(await response.json()).toEqual({});
	});

	it("stays out of the way of slash and mention drafts", async () => {
		mocks.candidates = [{ text: "/settings please", at: 1 }];
		expect(await (await handleChatCompletionPost(post({ text: "/sett" }))).json()).toEqual({});
		mocks.candidates = [{ text: "look at @src/lib/thing.ts", at: 1 }];
		expect(await (await handleChatCompletionPost(post({ text: "look at @src" }))).json()).toEqual({});
	});

	it("rejects a malformed body with 422", async () => {
		const response = await handleChatCompletionPost(post({ text: "" }));
		expect(response.status).toBe(422);
	});

	it("rejects a cross-origin request with 403", async () => {
		const response = await handleChatCompletionPost(
			post(
				{ text: "refactor the auth" },
				{ headers: { Origin: "https://evil.example", "Content-Type": "application/json" } },
			),
		);
		expect(response.status).toBe(403);
	});
});
