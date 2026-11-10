import { describe, expect, it } from "vitest";
import { openPanelActionFromParams } from "@/components/openui/open-panel-action-message";
import { openPanelAction, openUILibrary } from "@/components/openui/openui-library";

describe("OpenUI library contract", () => {
	it("declares Root as its entry so the no-root fallback can resolve", () => {
		expect(openUILibrary.root).toBe("Root");
	});

	it("exposes typed action props instead of an unconstrained schema", () => {
		const defs = openUILibrary.toJSONSchema().$defs;
		expect(defs?.Button?.properties?.action).toEqual({
			anyOf: [{ type: "string" }, { $ref: "#/$defs/ActionExpression" }],
		});
	});

	it("checks the cross-field OpenPanel constraint before dispatch", () => {
		for (const panel of ["workspace", "artifacts"])
			expect(openPanelAction.params.safeParse({ panel, relativePath: "web/app" }).success).toBe(true);
		const result = openPanelAction.params.safeParse({ panel: "repl", relativePath: "web/app" });
		expect(result.success).toBe(false);
		if (!result.success) expect(result.error.issues[0]?.path).toEqual(["relativePath"]);
	});
	it("registers the custom OpenPanel action", () => {
		expect(Object.keys(openUILibrary.actions ?? {})).toEqual(["OpenPanel"]);
	});

	it("registers the client functions used in prompts", () => {
		expect(Object.keys(openUILibrary.functions ?? {}).sort()).toEqual([
			"Bytes",
			"Duration",
			"Percent",
			"ShortPath",
			"Tokens",
		]);
	});
});

describe("openPanelActionFromParams", () => {
	it("accepts a valid panel", () => {
		expect(openPanelActionFromParams({ panel: "workspace", relativePath: "web/app" })).toEqual({
			panel: "workspace",
			relativePath: "web/app",
		});
	});

	it("rejects an unknown panel", () => {
		expect(openPanelActionFromParams({ panel: "nope" })).toBeUndefined();
	});

	it("rejects a relativePath for a panel that does not take one", () => {
		expect(openPanelActionFromParams({ panel: "repl", relativePath: "web/app" })).toBeUndefined();
	});

	it("rejects non-object params", () => {
		expect(openPanelActionFromParams(null)).toBeUndefined();
		expect(openPanelActionFromParams("workspace")).toBeUndefined();
	});

	it("preserves optional focus flag when validated", () => {
		expect(openPanelActionFromParams({ panel: "artifacts", focus: true })).toEqual({
			panel: "artifacts",
			focus: true,
		});
	});
});
