import { describe, expect, it } from "vitest";
import {
	applyPlanModeSelection,
	bindPendingPlanDecisionToolCallId,
	createEmptyPlanState,
	createPlanToolPart,
	resolvePlanDecision,
	updatePlanStateFromAssistantText,
} from "./plan-state";

describe("Plan-mode presentation state", () => {
	it("creates a single typed PlanWrite payload from an explicit Plan-mode checklist", () => {
		const planMode = applyPlanModeSelection(createEmptyPlanState(), "plan");
		const parsed = updatePlanStateFromAssistantText(
			planMode,
			"1. Review existing documentation.\n2. Compare terminology across guides.\n3. Report recommended corrections.",
		);
		const state = bindPendingPlanDecisionToolCallId(parsed.state, "assistant-42");
		const part = createPlanToolPart("assistant-42", state);

		expect(parsed.changed).toBe(true);
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

	it("does not classify ordinary Agent-mode text as a plan", () => {
		const parsed = updatePlanStateFromAssistantText(
			createEmptyPlanState(),
			"Note: the documentation is already consistent. Warning: no changes are needed.",
		);

		expect(parsed.changed).toBe(false);
		expect(createPlanToolPart("assistant-43", parsed.state)).toBeUndefined();
	});

	it("routes local execute and refine decisions into the next Fleet mode", () => {
		const planMode = applyPlanModeSelection(createEmptyPlanState(), "plan");
		const parsed = updatePlanStateFromAssistantText(planMode, "1. Inspect docs.\n2. Report findings.");

		const execute = resolvePlanDecision(parsed.state, {
			kind: "single",
			selectedIds: ["execute"],
		});
		const refine = resolvePlanDecision(parsed.state, {
			kind: "text",
			text: "Add an accessibility review step.",
		});

		expect(execute.response).toMatchObject({ ok: true, mode: "agent", planAction: "execute" });
		expect(refine.response).toMatchObject({ ok: true, mode: "plan", planAction: "refine" });
	});
});
