import { describe, expect, it } from "vitest";
import { INITIAL_AGENT_TAB_SCOPE_STATE, reduceAgentTabScope, visibleAgentTabScope } from "./agent-tab-state";

describe("agent tab scope state", () => {
	it("resets selected and dismissed tabs when the project/session scope changes", () => {
		const selected = reduceAgentTabScope(INITIAL_AGENT_TAB_SCOPE_STATE, {
			scopeKey: "project-a:session-a",
			tabId: "child-1",
			type: "select",
		});
		const dismissed = reduceAgentTabScope(selected, {
			scopeKey: "project-a:session-a",
			tabId: "child-2",
			type: "dismiss",
		});

		expect(visibleAgentTabScope(dismissed, "project-b:session-b")).toMatchObject({
			scopeKey: "project-b:session-b",
			selectedTabId: "main",
		});
		expect(visibleAgentTabScope(dismissed, "project-b:session-b").dismissedChildIds.size).toBe(0);
	});

	it("restores a dismissed child before selecting it", () => {
		const dismissed = reduceAgentTabScope(INITIAL_AGENT_TAB_SCOPE_STATE, {
			scopeKey: "project-a:session-a",
			tabId: "child-1",
			type: "dismiss",
		});
		const restored = reduceAgentTabScope(dismissed, {
			scopeKey: "project-a:session-a",
			tabId: "child-1",
			type: "restore",
		});

		expect(restored.dismissedChildIds.has("child-1")).toBe(false);
	});
});
