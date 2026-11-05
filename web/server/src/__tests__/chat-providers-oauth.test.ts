import { describe, expect, it } from "vitest";
import { handleChatProvidersOAuthPost } from "../handlers/chat-providers-oauth";

describe("handleChatProvidersOAuthPost", () => {
	it("returns terminal guidance without starting a provider flow or echoing prompt input", async () => {
		const response = await handleChatProvidersOAuthPost(
			new Request("http://localhost/api/chat/providers/oauth", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ providerId: "openai-codex", promptAnswer: "sensitive-user-input" }),
			}),
		);

		expect(response.status).toBe(501);
		const body = (await response.json()) as {
			status: string;
			error: string;
			loginId?: string;
			providers?: unknown[];
		};
		expect(body.status).toBe("error");
		expect(body.error).toContain("has to run inside Prime Agent");
		expect(body.error).toContain("/login");
		expect(body.error).toContain("PRIME_AGENT_CODING_AGENT_DIR");
		expect(body.error).not.toMatch(/restart Fleet/i);
		expect(body).not.toHaveProperty("loginId");
		expect(body).not.toHaveProperty("providers");
		expect(body.error).not.toContain("sensitive-user-input");
	});
});
