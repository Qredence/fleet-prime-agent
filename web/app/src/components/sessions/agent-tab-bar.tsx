import type { PrimeAgentRlmChild } from "@prime-agent/web-protocol/chat-protocol";
import { Activity, Bot } from "lucide-react";
import { useMemo } from "react";
import { TabStrip } from "@/components/layout/tab-strip";

/** Prefix shared by the tab trigger and tab panel IDs. */
const AGENT_TAB_ID_PREFIX = "agent-tab";

/**
 * Creates a deterministic ARIA ID for an agent tab trigger.
 */
export function agentTabTriggerId(tabId: string) {
	return `${AGENT_TAB_ID_PREFIX}-${encodeURIComponent(tabId)}`;
}

/**
 * Generates the ARIA ID for an agent tab panel.
 */
export function agentTabPanelId(tabId: string) {
	return `${AGENT_TAB_ID_PREFIX}-panel-${encodeURIComponent(tabId)}`;
}

export type AgentTabItem = {
	id: string;
	label: string;
	kind: "activity" | "main" | "subagent";
	status?: PrimeAgentRlmChild["status"];
};

/**
 * Maps an agent status to its accessible tab label.
 *
 * @param status - The agent status to label
 * @returns The corresponding label: `queued`, `streaming`, `error`, `cancelled`, `complete`, or `ready`
 */
function statusLabel(status: AgentTabItem["status"]): string {
	switch (status) {
		case "queued":
			return "queued";
		case "running":
		case "recovering":
			return "streaming";
		case "error":
		case "failed":
			return "error";
		case "cancelled":
			return "cancelled";
		case "done":
			return "complete";
		default:
			return "ready";
	}
}

/**
 * Determines the CSS classes for an agent status indicator.
 *
 * @param status - The agent status to represent
 * @returns CSS classes for the status indicator
 */
function statusDotClass(status: AgentTabItem["status"]): string {
	switch (status) {
		case "running":
		case "recovering":
			return "bg-success motion-safe:animate-pulse";
		case "error":
		case "failed":
			return "bg-destructive";
		case "queued":
			return "bg-warning";
		case "cancelled":
			return "bg-foreground/35";
		default:
			return "bg-foreground/35";
	}
}

/**
 * Renders a tab bar for agent conversations with selection, keyboard navigation, and optional tab-closing and new-session controls.
 *
 * @param tabs - The agent conversation tabs to display
 * @param value - The ID of the selected tab
 * @param onValueChange - Called when a tab is selected
 * @param onClose - Called with a subagent tab ID when that tab is closed
 * @param onNewSession - Called when the new-chat control is selected
 */
export function AgentTabBar({
	tabs,
	value,
	onValueChange,
	onClose,
	onNewSession,
}: {
	tabs: Array<AgentTabItem>;
	value: string;
	onValueChange: (tabId: string) => void;
	onClose?: (tabId: string) => void;
	onNewSession?: () => void;
}) {
	const items = useMemo(
		() =>
			tabs.map((tab) => ({
				id: tab.id,
				label: tab.label,
				icon: tab.kind === "activity" ? Activity : tab.kind === "main" ? Bot : undefined,
				dotClassName: tab.kind === "subagent" ? statusDotClass(tab.status) : undefined,
				statusLabel: statusLabel(tab.status),
				closable: tab.kind === "subagent" && Boolean(onClose),
			})),
		[tabs, onClose],
	);

	return (
		<TabStrip
			ariaLabel="Agent conversations"
			dataTestid="agent-tab-bar"
			idPrefix={AGENT_TAB_ID_PREFIX}
			onClose={onClose}
			onNewSession={onNewSession}
			onValueChange={onValueChange}
			tabs={items}
			value={value}
		/>
	);
}
