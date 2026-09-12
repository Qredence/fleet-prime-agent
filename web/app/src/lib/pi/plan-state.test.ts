import { describe, expect, it } from "vitest";
import type { TodoItem } from "./plan-parser";
import {
	applyPlanModeSelection,
	bindPendingPlanDecisionToolCallId,
	createEmptyPlanState,
	createPlanToolPart,
	type PlanModeState,
	resolvePlanDecision,
} from "./plan-state";

function planStateWithTodos(todos: Array<TodoItem>, extras: Partial<PlanModeState> = {}): PlanModeState {
	return {
		...applyPlanModeSelection(createEmptyPlanState(), "plan"),
		todos,
		pendingDecision: true,
		...extras,
	};
}

describe("Plan-mode presentation state", () => {
	it("creates a single typed PlanWrite payload from explicit plan todos", () => {
		const planMode = planStateWithTodos([
			{ step: 1, text: "Review existing documentation.", completed: false },
			{ step: 2, text: "Compare terminology across guides.", completed: false },
			{ step: 3, text: "Report recommended corrections.", completed: false },
		]);
		const state = bindPendingPlanDecisionToolCallId(planMode, "assistant-42");
		const part = createPlanToolPart("assistant-42", state);

		expect(part).toMatchObject({
			type: "tool-PlanWrite",
			toolCallId: "plan-mode-decision-assistant-42",
			state: "output-available",
			input: {
				pendingDecision: true,
				completed: 0,
				total: 3,
				plan: {
					id: "assistant-42",
					status: "awaiting_approval",
				},
			},
		});
	});

	it("does not invent a PlanWrite part without typed todos", () => {
		expect(createPlanToolPart("assistant-43", createEmptyPlanState())).toBeUndefined();
	});

	it("routes local execute and refine decisions into the next Fleet mode", () => {
		const planMode = planStateWithTodos([
			{ step: 1, text: "Inspect docs.", completed: false },
			{ step: 2, text: "Report findings.", completed: false },
		]);

		const execute = resolvePlanDecision(planMode, {
			kind: "single",
			selectedIds: ["execute"],
		});
		const refine = resolvePlanDecision(planMode, {
			kind: "text",
			text: "Add an accessibility review step.",
		});

		expect(execute.response).toMatchObject({ ok: true, mode: "agent", planAction: "execute" });
		expect(refine.response).toMatchObject({ ok: true, mode: "plan", planAction: "refine" });
	});
});
