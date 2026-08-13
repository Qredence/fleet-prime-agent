import { describe, expect, it } from "vitest";
import { seedMessageToSessionMessage } from "../src/modes/agent-connection/seed-messages.js";

describe("seedMessageToSessionMessage", () => {
	it("converts user seeds without extra metadata", () => {
		const message = seedMessageToSessionMessage({ role: "user", text: "hi" });
		expect(message).toMatchObject({ role: "user", content: "hi" });
	});

	it("fills required assistant metadata from the active model", () => {
		const model = {
			api: "google-generative-ai" as const,
			provider: "google" as const,
			id: "gemini-2.5-flash",
		};
		const message = seedMessageToSessionMessage({ role: "assistant", text: "hello" }, model);
		expect(message).toMatchObject({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
			api: "google-generative-ai",
			provider: "google",
			model: "gemini-2.5-flash",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
			stopReason: "stop",
		});
	});

	it("still produces a complete assistant message when no model is selected", () => {
		const message = seedMessageToSessionMessage({ role: "assistant", text: "hello" });
		expect(message.role).toBe("assistant");
		if (message.role !== "assistant") {
			return;
		}
		expect(message.api).toBeTruthy();
		expect(message.provider).toBeTruthy();
		expect(message.model).toBeTruthy();
		expect(message.usage.totalTokens).toBe(0);
		expect(message.stopReason).toBe("stop");
	});
});
