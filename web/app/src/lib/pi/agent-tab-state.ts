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

/**
 * Retrieves the state for a scope, creating a fresh default state when the scope changes.
 *
 * @param state - The current tab scope state
 * @param scopeKey - The scope key to retrieve
 * @returns The existing state when it matches `scopeKey`; otherwise, a default state for that scope
 */
function stateForScope(state: AgentTabScopeState, scopeKey: string): AgentTabScopeState {
	return state.scopeKey === scopeKey ? state : { dismissedChildIds: new Set(), scopeKey, selectedTabId: "main" };
}

/**
 * Provides the tab state for the requested project/session scope.
 *
 * @param state - The current tab scope state
 * @param scopeKey - The project/session scope identifier
 * @returns The current state when it matches the scope; otherwise, a fresh initial state
 */
export function visibleAgentTabScope(state: AgentTabScopeState, scopeKey: string): AgentTabScopeState {
	return stateForScope(state, scopeKey);
}

/**
 * Applies a tab selection, dismissal, or restoration action within its scope.
 *
 * @param action - The scoped tab action to apply
 * @returns The updated tab scope state
 */
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
