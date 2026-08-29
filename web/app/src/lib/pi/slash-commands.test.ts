import { describe, expect, it } from "vitest";
import { buildSlashCommands, resolveLocalSlashAction, WEB_BUILTIN_SLASH_COMMANDS } from "./slash-commands";

describe("buildSlashCommands", () => {
	it("keeps client dispatcher builtins when the API returns a short catalog", () => {
		const suggestions = buildSlashCommands(null, false, {
			commands: [
				{ name: "settings", description: "Open settings menu" },
				{ name: "session", description: "Show session info" },
			],
		});
		const ids = suggestions.map((item) => item.id);
		expect(ids).toContain("settings");
		expect(ids).toContain("login");
		expect(ids).toContain("fork");
		expect(ids).toContain("traces");
		expect(ids).toContain("mcp");
		expect(ids).toContain("tree");
		expect(ids.length).toBeGreaterThanOrEqual(WEB_BUILTIN_SLASH_COMMANDS.length);
	});
});

describe("resolveLocalSlashAction", () => {
	it("routes traces and agents locally so they do not fall through to the LLM", () => {
		expect(resolveLocalSlashAction("traces")).toEqual({ type: "session-traces" });
		expect(resolveLocalSlashAction("agents")).toEqual({ type: "session-agents" });
	});

	it("resolves /btw and /import without args instead of returning null", () => {
		expect(resolveLocalSlashAction("btw")).toEqual({ type: "session-btw", question: "" });
		expect(resolveLocalSlashAction("import")).toEqual({ type: "session-import", path: "" });
	});

	it("resolves /openui as a one-shot request and preserves the request text", () => {
		expect(resolveLocalSlashAction("openui", "Generate a Fleet Agent architecture visualization")).toEqual({
			type: "openui-request",
			request: "Generate a Fleet Agent architecture visualization",
		});
		expect(resolveLocalSlashAction("openui")).toEqual({ type: "openui-request", request: "" });
	});

	it("opens the effort picker for /effort and sets a named thinking level", () => {
		expect(resolveLocalSlashAction("effort")).toEqual({ type: "open-effort-picker" });
		expect(resolveLocalSlashAction("thinking")).toEqual({ type: "open-effort-picker" });
		expect(resolveLocalSlashAction("effort", "max")).toEqual({
			type: "set-thinking-level",
			level: "max",
		});
		expect(resolveLocalSlashAction("effort", "nope")).toEqual({
			type: "open-effort-picker",
			unknownLevel: "nope",
		});
	});

	it("every advertised local builtin resolves to a local action", () => {
		const backendSessionCommands = new Set(["compact", "refine", "goal", "autonomous"]);
		const unresolved = WEB_BUILTIN_SLASH_COMMANDS.filter(
			(command) => !backendSessionCommands.has(command.name) && resolveLocalSlashAction(command.name) === null,
		).map((command) => command.name);
		expect(unresolved).toEqual([]);
	});

	it("leaves session commands for the backend chat transport", () => {
		for (const [command, args] of [
			["compact", "keep the latest context"],
			["refine", "tighten memory"],
			["goal", "ship the web stack"],
			["autonomous", "on"],
		] as const) {
			expect(resolveLocalSlashAction(command, args)).toBeNull();
		}
	});

	it("advertises the OpenUI request hint without changing ordinary chat commands", () => {
		const openui = buildSlashCommands(null, false).find((item) => item.id === "openui");
		expect(openui).toMatchObject({
			label: "/openui",
			value: "/openui <request> ",
			description: "Generate a durable OpenUI HTML artifact",
		});
		expect(resolveLocalSlashAction("compact", "summarize")).toBeNull();
	});
});
