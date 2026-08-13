/**
 * Behavioral boundary awareness: InteractiveMode must reach extension /
 * session reads through AgentConnection, not a deleted local session host.
 *
 * Complements interactive-mode-boundary.test.ts (import lint) with a throwing
 * fake that fails loudly if a migrated path still touches a host-only shape.
 */
import { describe, expect, test, vi } from "vitest";
import type { AgentConnection, AgentConnectionExtensions } from "../src/modes/agent-connection/types.js";
import { AgentConnectionUnsupportedError } from "../src/modes/agent-connection/types.js";

function createThrowingFakeAgentConnection(
	overrides: Partial<AgentConnection> & { extensions?: Partial<AgentConnectionExtensions> } = {},
): AgentConnection {
	const throwUnstubbed = (name: string): never => {
		throw new Error(`FakeAgentConnection: unstubbed method ${name}`);
	};

	const extensions: AgentConnectionExtensions = {
		getArgumentCompletions: async () => null,
		getCommandDiagnostics: async () => [],
		getShortcutDiagnostics: async () => [],
		getShortcuts: async () => [],
		getKeyboardShortcuts: () => new Map(),
		getMessageRenderer: () => undefined,
		getToolRendererDefinition: async () => undefined,
		bindExtensions: async () => undefined,
		...overrides.extensions,
	};

	const base = new Proxy({} as AgentConnection, {
		get(_target, prop) {
			if (prop === "extensions") return extensions;
			if (prop === "then") return undefined;
			if (typeof prop === "string" && prop in overrides) {
				return (overrides as Record<string, unknown>)[prop];
			}
			return () => throwUnstubbed(String(prop));
		},
	});

	return base;
}

describe("interactive-mode boundary awareness", () => {
	test("createFakeAgentConnection throws on unstubbed methods", () => {
		const fake = createThrowingFakeAgentConnection({
			getAbortSignal: () => undefined,
		});
		expect(fake.getAbortSignal()).toBeUndefined();
		expect(() => fake.getReadonlySessionManager()).toThrow(/unstubbed method getReadonlySessionManager/);
	});

	test("extensions surface is reachable without a local session host", async () => {
		const bindExtensions = vi.fn(async () => undefined);
		const getArgumentCompletions = vi.fn(async () => [{ value: "gpt", label: "gpt" }]);
		const fake = createThrowingFakeAgentConnection({
			extensions: {
				bindExtensions,
				getArgumentCompletions,
				getCommandDiagnostics: async () => [],
				getShortcutDiagnostics: async () => [],
				getShortcuts: async () => [],
				getKeyboardShortcuts: () => new Map(),
				getMessageRenderer: () => undefined,
				getToolRendererDefinition: async () => undefined,
			},
		});

		await fake.extensions.bindExtensions({});
		const completions = await fake.extensions.getArgumentCompletions("model", "g");
		expect(bindExtensions).toHaveBeenCalledOnce();
		expect(completions).toEqual([{ value: "gpt", label: "gpt" }]);
	});

	test("daemon-shaped unsupported errors are distinguishable", () => {
		const error = new AgentConnectionUnsupportedError(
			"extensions.bindExtensions is process-local; daemon adapters throw AgentConnectionUnsupportedError",
			"extensions.bindExtensions",
		);
		expect(error).toBeInstanceOf(AgentConnectionUnsupportedError);
		expect(error.feature).toBe("extensions.bindExtensions");
	});
});
