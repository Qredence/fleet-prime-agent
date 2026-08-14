import { describe, expect, it } from "vitest";
import { resolveProviderAuthFields } from "../handlers/chat-providers";

describe("resolveProviderAuthFields", () => {
	it("keeps API-key editing available for dual-auth catalog providers", () => {
		expect(resolveProviderAuthFields("anthropic", "", new Set(["anthropic"]))).toEqual({
			authType: "apiKey",
			supportsOAuth: true,
		});
	});

	it("marks catalog OAuth-only providers as OAuth-only", () => {
		expect(resolveProviderAuthFields("github-copilot", "GITHUB_COPILOT_TOKEN", new Set(["github-copilot"]))).toEqual({
			authType: "oauth",
			supportsOAuth: true,
		});
	});

	it("treats an unlisted OAuth provider without an API-key field as OAuth-only", () => {
		expect(resolveProviderAuthFields("openai-codex", "", new Set(["openai-codex"]))).toEqual({
			authType: "oauth",
			supportsOAuth: true,
		});
	});
});
