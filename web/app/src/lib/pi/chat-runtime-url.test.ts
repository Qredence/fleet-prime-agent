import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveChatApiUrl } from "./chat-runtime-url";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("resolveChatApiUrl", () => {
	it("routes health checks to the configured runtime and preserves queries", () => {
		vi.stubEnv("VITE_FLEET_PI_CHAT_RUNTIME_URL", "https://runtime.example/");

		expect(resolveChatApiUrl("/api/health")).toBe("https://runtime.example/api/health");
		expect(resolveChatApiUrl("/api/health?session=1")).toBe("https://runtime.example/api/health?session=1");
	});

	it.each([
		"/api/chat/events?sessionId=session-1",
		"/api/projects",
		"/api/projects/browse?token=directory-token",
		"/api/workspace/tree?projectId=project-1",
		"/api/workspace/file?path=README.md",
	])("routes %s to the configured runtime", (path) => {
		vi.stubEnv("VITE_FLEET_PI_CHAT_RUNTIME_URL", "https://runtime.example/");

		expect(resolveChatApiUrl(path)).toBe(`https://runtime.example${path}`);
	});

	it("does not route similarly named frontend paths", () => {
		vi.stubEnv("VITE_FLEET_PI_CHAT_RUNTIME_URL", "https://runtime.example");

		expect(resolveChatApiUrl("/api/projects-local")).toBe("/api/projects-local");
		expect(resolveChatApiUrl("/assets/chat.js")).toBe("/assets/chat.js");
	});

	it("leaves health checks local when no runtime is configured", () => {
		vi.stubEnv("VITE_FLEET_PI_CHAT_RUNTIME_URL", "");

		expect(resolveChatApiUrl("/api/health")).toBe("/api/health");
	});
});
