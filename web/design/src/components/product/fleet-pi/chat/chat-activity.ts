import type { AgentActivityItem } from "../../../registry/beui/agents/agent-activity/index";

export function activityLabelFor(items: AgentActivityItem[]) {
	if (items.length === 1) {
		const item = items[0];
		if (item?.type === "search") return "Checking a source…";
		if (item?.type === "tool") return `Working with ${item.action}…`;
	}
	if (items.length > 1) return `Coordinating ${items.length} active actions…`;
	return "Working through the run…";
}

export function activitySummary(items: AgentActivityItem[]) {
	return items.length === 1 ? "Completed 1 tracked action" : `Completed ${items.length} tracked actions`;
}
