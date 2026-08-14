import { describe, expect, it } from "vitest";
import { resolveLocalSlashAction } from "./slash-commands";

describe("resolveLocalSlashAction", () => {
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
});
