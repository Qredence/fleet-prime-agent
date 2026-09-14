import type {
	ChatMode,
	ChatPlanAction,
	ChatPlanState,
	ChatQuestionAnswer,
	ChatQuestionAnswerResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatToolPart } from "@prime-agent/web-protocol/chat-types";
import type { TodoItem } from "./plan-parser";

export const PLAN_DECISION_TOOL_PREFIX = "plan-mode-decision";

export type PlanModeState = {
	enabled: boolean;
	executing: boolean;
	todos: Array<TodoItem>;
	pendingDecision?: boolean;
	pendingDecisionToolCallId?: string;
};

export function createEmptyPlanState(): PlanModeState {
	return {
		enabled: false,
		executing: false,
		todos: [],
		pendingDecision: false,
		pendingDecisionToolCallId: undefined,
	};
}

export function applyPlanModeSelection(state: PlanModeState, mode?: ChatMode, planAction?: ChatPlanAction) {
	const nextState = cloneState(state);

	if (planAction === "execute") {
		nextState.enabled = false;
		nextState.executing = nextState.todos.some((todo) => !todo.completed);
		nextState.pendingDecision = false;
		nextState.pendingDecisionToolCallId = undefined;
		return nextState;
	}

	if (planAction === "refine" || mode === "plan") {
		nextState.enabled = true;
		nextState.executing = false;
		nextState.pendingDecisionToolCallId = undefined;
		return nextState;
	}

	nextState.enabled = false;
	nextState.executing = false;
	nextState.pendingDecision = false;
	nextState.pendingDecisionToolCallId = undefined;
	return nextState;
}

export function planStateFromChatPlanState(state: ChatPlanState, assistantId: string): PlanModeState {
	return {
		enabled: state.mode === "plan",
		executing: state.executing,
		todos: state.todos.map((todo) => ({ ...todo })),
		pendingDecision: state.pendingDecision,
		pendingDecisionToolCallId: state.pendingDecision ? `${PLAN_DECISION_TOOL_PREFIX}-${assistantId}` : undefined,
	};
}

export function createPlanToolPartFromChatPlanState(assistantId: string, state: ChatPlanState) {
	return createPlanToolPart(assistantId, planStateFromChatPlanState(state, assistantId));
}
export function createPlanToolPart(assistantId: string, state: PlanModeState): ChatToolPart | undefined {
	if (state.todos.length === 0) return undefined;

	const snapshot = toChatPlanState(state);
	const status = state.pendingDecision
		? "awaiting_approval"
		: snapshot.total > 0 && snapshot.completed === snapshot.total
			? "completed"
			: "approved";

	return {
		type: "tool-PlanWrite",
		toolCallId: state.pendingDecisionToolCallId ?? `${PLAN_DECISION_TOOL_PREFIX}-${assistantId}`,
		state: "output-available",
		input: {
			action: state.pendingDecision ? "create" : "update",
			pendingDecision: state.pendingDecision,
			executing: state.executing,
			completed: snapshot.completed,
			total: snapshot.total,
			presentation: snapshot,
			plan: {
				id: assistantId,
				title: snapshot.executing ? "Executing plan" : "Execution plan",
				summary: formatPlanSummary(state),
				status,
				todos: snapshot.todos,
			},
		},
	};
}

export function isPlanDecisionToolCall(toolCallId?: string) {
	return Boolean(toolCallId?.startsWith(PLAN_DECISION_TOOL_PREFIX));
}

export function bindPendingPlanDecisionToolCallId(state: PlanModeState, assistantId: string) {
	if (!state.pendingDecision) return state;

	const toolCallId = `${PLAN_DECISION_TOOL_PREFIX}-${assistantId}`;
	if (state.pendingDecisionToolCallId === toolCallId) return state;

	return {
		...cloneState(state),
		pendingDecisionToolCallId: toolCallId,
	};
}

export function resolvePlanDecision(
	state: PlanModeState,
	answer: ChatQuestionAnswer,
): {
	state: PlanModeState;
	response: ChatQuestionAnswerResponse;
} {
	const nextState = cloneState(state);
	const selected = answer.selectedIds?.[0];
	nextState.pendingDecision = false;
	nextState.pendingDecisionToolCallId = undefined;

	if (selected === "execute") {
		nextState.enabled = false;
		nextState.executing = nextState.todos.some((todo) => !todo.completed);
		const first = nextState.todos.find((todo) => !todo.completed);
		return {
			state: nextState,
			response: {
				ok: true,
				message: first ? `Execute the plan. Start with: ${first.text}` : "Execute the plan you just created.",
				mode: "agent",
				planAction: "execute",
			},
		};
	}

	if (selected === "refine" || (!selected && answer.text?.trim())) {
		nextState.enabled = true;
		nextState.executing = false;
		return {
			state: nextState,
			response: {
				ok: true,
				message: answer.text?.trim() || "Refine the plan.",
				mode: "plan",
				planAction: "refine",
			},
		};
	}

	nextState.enabled = true;
	nextState.executing = false;
	return {
		state: nextState,
		response: { ok: true },
	};
}

export function toChatPlanState(state: PlanModeState): ChatPlanState {
	const completed = state.todos.filter((todo) => todo.completed).length;
	const total = state.todos.length;
	const mode: ChatMode = state.enabled ? "plan" : "agent";
	const message = state.executing
		? total > 0
			? `Plan progress ${completed}/${total}`
			: "Executing plan"
		: state.pendingDecision
			? "Plan ready for review"
			: state.enabled
				? "Plan mode"
				: undefined;

	return {
		mode,
		executing: state.executing,
		pendingDecision: Boolean(state.pendingDecision),
		completed,
		total,
		todos: state.todos.map((todo) => ({ ...todo })),
		message,
	};
}

function cloneState(state: PlanModeState): PlanModeState {
	return {
		enabled: state.enabled,
		executing: state.executing,
		todos: state.todos.map((todo) => ({ ...todo })),
		pendingDecision: Boolean(state.pendingDecision),
		pendingDecisionToolCallId: state.pendingDecisionToolCallId,
	};
}

function formatPlanSummary(state: PlanModeState) {
	const snapshot = toChatPlanState(state);
	const lines = snapshot.todos.map((todo) => `${todo.completed ? "- [x]" : "- [ ]"} ${todo.step}. ${todo.text}`);

	if (state.pendingDecision) {
		lines.push("", "Review the steps, then execute, stay in plan mode, or refine.");
	} else if (snapshot.executing) {
		lines.push("", `Progress: ${snapshot.completed}/${snapshot.total} completed.`);
	} else if (snapshot.total > 0 && snapshot.completed === snapshot.total) {
		lines.push("", "All plan steps are complete.");
	}

	return lines.join("\n");
}
