import { describe, expect, it } from "vitest";
import {
	buildSlashCommands,
	resolveLocalSlashAction,
	slashCommandInsertsPrefixOnSelect,
	WEB_BUILTIN_SLASH_COMMANDS,
} from "./slash-commands";

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

	it("resolves /mcp locally so it can open the MCP settings surface", () => {
		expect(resolveLocalSlashAction("mcp")).toEqual({ type: "open-mcp", args: "" });
		expect(resolveLocalSlashAction("mcp", "logout linear")).toEqual({
			type: "open-mcp",
			args: "logout linear",
		});
	});

	it("does not execute empty /name on select so Usage is not shown until submit", () => {
		expect(slashCommandInsertsPrefixOnSelect({ id: "name" })).toBe(true);
		expect(resolveLocalSlashAction("name")).toEqual({ type: "session-rename", name: undefined });
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
			value: "/openui ",
			description: "Generate a durable OpenUI HTML artifact",
			metadata: { argumentHint: "<request>" },
		});
		expect(resolveLocalSlashAction("compact", "summarize")).toBeNull();
	});
});

describe("slashCommandInsertsPrefixOnSelect", () => {
	it("inserts a prefix for argument-taking builtins instead of executing them", () => {
		for (const id of ["name", "import", "btw", "openui", "mcp"]) {
			expect(slashCommandInsertsPrefixOnSelect({ id })).toBe(true);
		}
	});

	it("still executes commands that do not take arguments", () => {
		for (const id of ["settings", "copy", "clone", "share"]) {
			expect(slashCommandInsertsPrefixOnSelect({ id })).toBe(false);
		}
	});

	it("keeps the argument hint out of the composer value", () => {
		const suggestions = buildSlashCommands(null, false);
		for (const id of ["name", "import", "btw", "openui", "mcp"]) {
			const suggestion = suggestions.find((item) => item.id === id);
			expect(suggestion?.value).toBe(`/${id} `);
			expect(suggestion?.value).not.toMatch(/\[|</);
		}
	});
});
