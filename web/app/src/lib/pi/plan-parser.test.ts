import { describe, expect, it } from "vitest";
import { extractTodoItems } from "./plan-parser";

describe("extractTodoItems", () => {
	it("extracts numbered checklist items beneath an explicit Plan heading", () => {
		expect(extractTodoItems("Plan:\n1. Inspect the workspace\n2. Draft findings")).toEqual([
			{ step: 1, text: "Inspect the workspace", completed: false },
			{ step: 2, text: "Draft findings", completed: false },
		]);
	});

	it("extracts a concise numbered plan without requiring a literal Plan heading", () => {
		expect(
			extractTodoItems("1. Review guidance and scope\n2. Check documentation alignment\n3. Deliver findings only"),
		).toEqual([
			{ step: 1, text: "Review guidance and scope", completed: false },
			{ step: 2, text: "Documentation alignment", completed: false },
			{ step: 3, text: "Deliver findings only", completed: false },
		]);
	});

	it("extracts concise titled plan steps from a Plan-mode response", () => {
		expect(
			extractTodoItems(
				"Read applicable guidance: Review the relevant instructions.\n\nAudit documentation alignment: Compare commands and configuration.\n\nReport findings: List discrepancies without edits.",
			),
		).toEqual([
			{ step: 1, text: "Applicable guidance", completed: false },
			{ step: 2, text: "Audit documentation alignment", completed: false },
			{ step: 3, text: "Report findings", completed: false },
		]);
	});

	it("preserves full plain multi-line Plan-mode steps for the official checklist", () => {
		expect(
			extractTodoItems(
				"Review workspace guidance and documentation structure without modifying files.\nCompare documentation claims against the current repository configuration and source layout, noting only clear inconsistencies or gaps.\nReport findings with file references and recommended documentation-only updates, without applying changes.",
			),
		).toEqual([
			{
				step: 1,
				text: "Review workspace guidance and documentation structure without modifying files.",
				completed: false,
			},
			{
				step: 2,
				text: "Compare documentation claims against the current repository configuration and source layout, noting only clear inconsistencies or gaps.",
				completed: false,
			},
			{
				step: 3,
				text: "Report findings with file references and recommended documentation-only updates, without applying changes.",
				completed: false,
			},
		]);
	});

	it("does not mistake a single ordinary numbered sentence for a plan", () => {
		expect(extractTodoItems("1. This is one isolated numbered point.")).toEqual([]);
	});
});
