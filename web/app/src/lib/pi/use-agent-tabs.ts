import type { AgentTabItem } from "@prime-agent/web-design/components/product/fleet-pi/layout/agent-tab-bar";
import { normalizeSessionLabel } from "@prime-agent/web-design/lib/pi/chat-helpers";
import { orderedRlmChildren } from "@prime-agent/web-design/lib/pi/subagent-utils";
import type { PrimeAgentRlmChild, PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import type { ProjectId } from "@prime-agent/web-protocol/fleet-contract";
import { useCallback, useMemo, useReducer } from "react";
import { INITIAL_AGENT_TAB_SCOPE_STATE, reduceAgentTabScope, visibleAgentTabScope } from "./agent-tab-state";
import { type ChatClient, chatClient } from "./chat-client";
import { useSubagentChat } from "./use-subagent-chat";

export type AgentTabConversation = ReturnType<typeof useSubagentChat>;

/**
 * Derives a display label for a subagent child.
 *
 * @param child - The subagent child whose session name or fallback label is used
 * @returns The normalized child label, or `Subagent` when no label is available
 */
function childLabel(child: PrimeAgentRlmChild): string {
	return normalizeSessionLabel(child.sessionName?.trim() || child.label) || "Subagent";
}

/**
 * Manages the main-agent and subagent tabs for an agent session.
 *
 * @param activeProjectId - The project whose agent tabs are managed
 * @param loadSubagentSession - Loads a subagent conversation
 * @param presentation - Session data used to build the subagent tabs
 * @param rootSessionId - The root session associated with the tabs
 * @param client - The chat client used to load subagent conversations
 * @returns The active tab, tab controls, available tabs, selected subagent, and its conversation state
 */
export function useAgentTabs({
	activeProjectId,
	loadSubagentSession,
	presentation,
	rootSessionId,
	client = chatClient,
}: {
	activeProjectId?: ProjectId;
	loadSubagentSession: ChatClient["loadSubagentSession"];
	presentation: PrimeAgentSessionPresentation;
	rootSessionId?: string;
	client?: ChatClient;
}) {
	const scopeKey = `${activeProjectId ?? ""}:${rootSessionId ?? ""}`;
	const [tabScope, dispatchTabScope] = useReducer(reduceAgentTabScope, INITIAL_AGENT_TAB_SCOPE_STATE);
	const { dismissedChildIds, selectedTabId } = visibleAgentTabScope(tabScope, scopeKey);
	const orderedChildren = useMemo(
		() => orderedRlmChildren(presentation.rlmChildren, presentation.rlmTree),
		[presentation.rlmChildren, presentation.rlmTree],
	);

	const tabs = useMemo<Array<AgentTabItem>>(
		() => [
			{ id: "main", label: "Main agent", kind: "main" },
			...orderedChildren
				.filter((child) => !dismissedChildIds.has(child.id))
				.map((child) => ({
					id: child.id,
					label: childLabel(child),
					kind: "subagent" as const,
					status: child.status,
				})),
		],
		[dismissedChildIds, orderedChildren],
	);

	const activeTabId = tabs.some((tab) => tab.id === selectedTabId) ? selectedTabId : "main";
	const selectedChild = orderedChildren.find((child) => child.id === activeTabId);

	const selectTab = useCallback(
		(tabId: string) => {
			if (tabId !== "main" && !orderedChildren.some((child) => child.id === tabId)) return;
			if (tabId !== "main") {
				dispatchTabScope({ type: "restore", scopeKey, tabId });
			}
			dispatchTabScope({ type: "select", scopeKey, tabId });
		},
		[orderedChildren, scopeKey],
	);

	const closeTab = useCallback(
		(tabId: string) => {
			if (tabId === "main" || !orderedChildren.some((child) => child.id === tabId)) return;
			dispatchTabScope({ type: "dismiss", scopeKey, tabId });
		},
		[orderedChildren, scopeKey],
	);

	const openChildTab = useCallback((childId: string) => selectTab(childId), [selectTab]);
	const childConversation = useSubagentChat({
		client,
		child: selectedChild,
		enabled: activeTabId !== "main" && !!selectedChild,
		loadSession: loadSubagentSession,
		parentSessionId: rootSessionId,
	});

	return {
		activeTabId,
		closeTab,
		conversation: childConversation,
		openChildTab,
		selectedChild,
		selectTab,
		tabs,
	};
}
