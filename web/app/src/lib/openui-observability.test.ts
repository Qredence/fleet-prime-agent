import { afterEach, describe, expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());

vi.mock("@openuidev/observability-cloud", () => ({
	init,
}));

import { initOpenUIObservability } from "@/lib/openui-observability";

afterEach(() => {
	init.mockClear();
	vi.unstubAllEnvs();
});

describe("initOpenUIObservability", () => {
	it("stays quiet without a client key", () => {
		vi.stubEnv("VITE_OPENUI_CLIENT_KEY", "");

		initOpenUIObservability();

		expect(init).not.toHaveBeenCalled();
	});

	it("rejects a server key", () => {
		vi.stubEnv("VITE_OPENUI_CLIENT_KEY", "sk-server-key");

		initOpenUIObservability();

		expect(init).not.toHaveBeenCalled();
	});

	it("initializes with a browser client key", () => {
		vi.stubEnv("VITE_OPENUI_CLIENT_KEY", "pk-th-test");

		initOpenUIObservability();

		expect(init).toHaveBeenCalledTimes(1);
		expect(init).toHaveBeenCalledWith({ apiKey: "pk-th-test" });
	});
});
