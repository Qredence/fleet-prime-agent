import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { describe, expect, it } from "vitest";
import { hydratePlanPresentationMessages, planPresentationForToolCall } from "./plan-presentation";
import { resolvePlanDecisionMessages } from "./use-pi-chat-plan-decisions";

const planState = {
	mode: "plan" as const,
	executing: false,
	pendingDecision: true,
	completed: 0,
	total: 2,
	todos: [
		{ step: 1, text: "Review the documented browser-safe event contract in full.", completed: false },
		{ step: 2, text: "Report only validated gaps without modifying runtime behavior.", completed: false },
	],
	message: "Plan ready for review",
};

describe("durable Plan presentation hydration", () => {
	it("rehydrates an explicit durable Plan record into exactly one typed PlanWrite part", () => {
		const messages: Array<ChatMessage> = [
			{
				id: "session-m2",
				role: "assistant",
				createdAt: 1,
				parts: [{ type: "text", text: "1. Review docs.\n2. Report gaps." }],
			},
		];
		const hydrated = hydratePlanPresentationMessages(messages, [
			{ assistantMessageId: "session-m2", state: planState },
		]);
		const parts = hydrated[0]?.parts ?? [];
		const plans = parts.filter((part) => part.type === "tool-PlanWrite");
		expect(plans).toHaveLength(1);
		expect(plans[0]).toMatchObject({
			toolCallId: "plan-mode-decision-session-m2",
			input: { pendingDecision: true, presentation: planState },
		});
		expect(parts.some((part) => part.type === "tool-Thinking")).toBe(false);
	});

	it("does not turn ordinary assistant text into a Plan without an explicit durable record", () => {
		const messages: Array<ChatMessage> = [
			{
				id: "session-m4",
				role: "assistant",
				createdAt: 1,
				parts: [{ type: "text", text: "1. Ordinary point.\n2. Another point." }],
			},
		];
		expect(hydratePlanPresentationMessages(messages, [])).toEqual(messages);
	});

	it("persists the local Execute decision as an agent-mode, non-pending plan snapshot", () => {
		const hydrated = hydratePlanPresentationMessages(
			[{ id: "session-m2", role: "assistant", createdAt: 1, parts: [{ type: "text", text: "Plan text" }] }],
			[{ assistantMessageId: "session-m2", state: planState }],
		);
		const decided = resolvePlanDecisionMessages(hydrated, "plan-mode-decision-session-m2", {
			kind: "single",
			selectedIds: ["execute"],
		});
		const presentation = planPresentationForToolCall(decided, "plan-mode-decision-session-m2");
		expect(presentation?.state).toMatchObject({ mode: "agent", executing: true, pendingDecision: false, total: 2 });
	});
});
