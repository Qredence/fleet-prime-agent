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

	it("every advertised builtin resolves to a local action", () => {
		const unresolved = WEB_BUILTIN_SLASH_COMMANDS.filter(
			(command) => resolveLocalSlashAction(command.name) === null,
		).map((command) => command.name);
		expect(unresolved).toEqual([]);
	});

	it("routes compact, refine, goal, and autonomous to local echo stubs", () => {
		expect(resolveLocalSlashAction("compact")).toEqual({
			type: "echo",
			text: "/compact is not wired in the web port.",
		});
		expect(resolveLocalSlashAction("refine", "tighten memory")).toEqual({
			type: "echo",
			text: "/refine is not wired in the web port. Arguments were not applied:\ntighten memory",
		});
		expect(resolveLocalSlashAction("goal")).toEqual({
			type: "echo",
			text: "/goal is not wired in the web port.",
		});
		expect(resolveLocalSlashAction("autonomous", "on")).toEqual({
			type: "echo",
			text: "/autonomous is not wired in the web port. Arguments were not applied:\non",
		});
	});
});
