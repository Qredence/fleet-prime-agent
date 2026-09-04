import type { AgentTabItem } from "@prime-agent/web-design/components/product/fleet-pi/layout/agent-tab-bar";
import { normalizeSessionLabel } from "@prime-agent/web-design/lib/pi/chat-helpers";
import { orderedRlmChildren } from "@prime-agent/web-design/lib/pi/subagent-utils";
import type { PrimeAgentRlmChild, PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import type { ProjectId } from "@prime-agent/web-protocol/fleet-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ChatClient, chatClient } from "./chat-client";
import { useSubagentChat } from "./use-subagent-chat";

export type AgentTabConversation = ReturnType<typeof useSubagentChat>;

function childLabel(child: PrimeAgentRlmChild): string {
	return normalizeSessionLabel(child.sessionName?.trim() || child.label) || "Subagent";
}

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
	const [selectedTabId, setSelectedTabId] = useState("main");
	const [dismissedChildIds, setDismissedChildIds] = useState<ReadonlySet<string>>(new Set());
	const scopeKeyRef = useRef(`${activeProjectId ?? ""}:${rootSessionId ?? ""}`);
	const orderedChildren = useMemo(
		() => orderedRlmChildren(presentation.rlmChildren, presentation.rlmTree),
		[presentation.rlmChildren, presentation.rlmTree],
	);

	useEffect(() => {
		const nextScopeKey = `${activeProjectId ?? ""}:${rootSessionId ?? ""}`;
		if (scopeKeyRef.current === nextScopeKey) return;
		scopeKeyRef.current = nextScopeKey;
		setSelectedTabId("main");
		setDismissedChildIds(new Set());
	}, [activeProjectId, rootSessionId]);

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
				setDismissedChildIds((current) => {
					if (!current.has(tabId)) return current;
					const next = new Set(current);
					next.delete(tabId);
					return next;
				});
			}
			setSelectedTabId(tabId);
		},
		[orderedChildren],
	);

	const closeTab = useCallback(
		(tabId: string) => {
			if (tabId === "main" || !orderedChildren.some((child) => child.id === tabId)) return;
			setDismissedChildIds((current) => new Set(current).add(tabId));
			setSelectedTabId((current) => (current === tabId ? "main" : current));
		},
		[orderedChildren],
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
