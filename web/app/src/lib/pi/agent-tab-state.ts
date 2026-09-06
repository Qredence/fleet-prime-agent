export type AgentTabScopeState = {
	dismissedChildIds: ReadonlySet<string>;
	scopeKey: string;
	selectedTabId: string;
};

export type AgentTabScopeAction =
	| { type: "select"; scopeKey: string; tabId: string }
	| { type: "dismiss"; scopeKey: string; tabId: string }
	| { type: "restore"; scopeKey: string; tabId: string };

export const INITIAL_AGENT_TAB_SCOPE_STATE: AgentTabScopeState = {
	dismissedChildIds: new Set(),
	scopeKey: "",
	selectedTabId: "main",
};

function stateForScope(state: AgentTabScopeState, scopeKey: string): AgentTabScopeState {
	return state.scopeKey === scopeKey ? state : { dismissedChildIds: new Set(), scopeKey, selectedTabId: "main" };
}

/**
 * Keeps tab-local state scoped to the selected project/session pair. A stale
 * scope is treated as its initial state until the next user action, avoiding a
 * prop-driven state reset effect during render.
 */
export function visibleAgentTabScope(state: AgentTabScopeState, scopeKey: string): AgentTabScopeState {
	return stateForScope(state, scopeKey);
}

export function reduceAgentTabScope(state: AgentTabScopeState, action: AgentTabScopeAction): AgentTabScopeState {
	const current = stateForScope(state, action.scopeKey);
	if (action.type === "select") return { ...current, selectedTabId: action.tabId };
	if (action.type === "dismiss") {
		return {
			...current,
			dismissedChildIds: new Set(current.dismissedChildIds).add(action.tabId),
			selectedTabId: current.selectedTabId === action.tabId ? "main" : current.selectedTabId,
		};
	}
	const dismissedChildIds = new Set(current.dismissedChildIds);
	dismissedChildIds.delete(action.tabId);
	return { ...current, dismissedChildIds };
}
