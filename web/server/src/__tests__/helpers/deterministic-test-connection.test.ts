import { describe, expect, it, vi } from "vitest";
import { createDeterministicTestAgentConnection } from "./deterministic-test-connection";

describe("createDeterministicTestAgentConnection", () => {
	it("returns the fixture transcript and stable connection state without a runtime session", async () => {
		const message = { role: "user", content: "fixture prompt", timestamp: 0 } as const;
		const agent = createDeterministicTestAgentConnection(
			{
				cwd: "/fixture/project",
				openUIPrompt: { enabled: false, mode: "agent", prompt: "" },
			},
			{ sessionId: "fixture-session", messages: [message] },
		);

		await expect(agent.connection.getState()).resolves.toMatchObject({
			sessionId: "fixture-session",
			cwd: "/fixture/project",
			messageCount: 1,
			isStreaming: false,
		});
		await expect(agent.connection.getMessages()).resolves.toEqual([message]);
		expect(agent.session).toBeUndefined();
	});

	it("delivers fixture events and releases listeners", async () => {
		const agent = createDeterministicTestAgentConnection({
			cwd: "/fixture/project",
			openUIPrompt: { enabled: false, mode: "agent", prompt: "" },
		});
		const listener = vi.fn();
		const unsubscribe = agent.connection.subscribe(listener);
		agent.testControls.emit({} as never);
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
		expect(agent.testControls.listenerCount()).toBe(0);
		agent.testControls.emit({} as never);
		expect(listener).toHaveBeenCalledTimes(1);
		await agent.connection.dispose();
		expect(agent.testControls.listenerCount()).toBe(0);
	});
});
