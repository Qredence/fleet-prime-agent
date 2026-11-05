import { afterEach, describe, expect, it, vi } from "vitest";
import { chatClient } from "@/components/chat/chat-client";
import { createOpenUIToolProvider } from "@/components/openui/openui-tools";

afterEach(() => vi.unstubAllGlobals());

describe("OpenUI browser requests", () => {
	it.each(["workspace_tree", "list_resources"])("sends the active project's context for %s", async (name) => {
		const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			Response.json({ ok: true, rows: [] }),
		);
		vi.stubGlobal("fetch", fetch);
		await createOpenUIToolProvider("project:b")[name]({});
		expect(fetch.mock.calls[0]?.[0]).toBe("/api/chat/openui/tool?projectId=project%3Ab");
	});
	it("declares 1.x on current OpenUI turns, including queued stream requests", async () => {
		const fetch = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.close();
						},
					}),
					{ headers: { "Content-Type": "application/x-ndjson" } },
				),
		);
		vi.stubGlobal("fetch", fetch);
		for (const streamingBehavior of [undefined, "steer", "followUp"] as const) {
			await chatClient.streamMessage({ message: "show data", openUI: true, streamingBehavior }, () => {});
		}
		for (const [, init] of fetch.mock.calls) expect(JSON.parse(String(init?.body)).openUISyntaxVersion).toBe("1.x");
	});
});
