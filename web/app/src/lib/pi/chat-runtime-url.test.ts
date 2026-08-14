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

	it("leaves health checks local when no runtime is configured", () => {
		vi.stubEnv("VITE_FLEET_PI_CHAT_RUNTIME_URL", "");

		expect(resolveChatApiUrl("/api/health")).toBe("/api/health");
	});
});
