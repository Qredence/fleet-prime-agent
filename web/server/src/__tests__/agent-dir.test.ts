import { describe, expect, it } from "vitest";
import { resolveAgentDir } from "../agent-dir";

describe("resolveAgentDir", () => {
	it("uses the Prime Agent home-relative default", () => {
		expect(resolveAgentDir({}, "/users/example")).toBe("/users/example/.prime/agent");
	});

	it("honors the runtime override and expands home shorthand", () => {
		expect(resolveAgentDir({ PRIME_AGENT_CODING_AGENT_DIR: "/custom/agent" }, "/users/example")).toBe(
			"/custom/agent",
		);
		expect(resolveAgentDir({ PRIME_AGENT_CODING_AGENT_DIR: "~/alternate" }, "/users/example")).toBe(
			"/users/example/alternate",
		);
	});

	it("preserves relative overrides as the runtime does", () => {
		expect(resolveAgentDir({ PRIME_AGENT_CODING_AGENT_DIR: "runtime-agent-dir" }, "/users/example")).toBe(
			"runtime-agent-dir",
		);
	});
});
