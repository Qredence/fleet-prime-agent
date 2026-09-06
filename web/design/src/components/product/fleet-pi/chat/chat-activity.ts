import type { AgentActivityItem } from "../../../registry/beui/agents/agent-activity/index";

/**
 * Creates a status label for the current agent activities.
 *
 * @param items - The activities currently tracked for the agent
 * @returns A status label based on the activity count and type
 */
export function activityLabelFor(items: AgentActivityItem[]) {
	if (items.length === 1) {
		const item = items[0];
		if (item?.type === "search") return "Checking a source…";
		if (item?.type === "tool") return `Working with ${item.action}…`;
	}
	if (items.length > 1) return `Coordinating ${items.length} active actions…`;
	return "Working through the run…";
}

/**
 * Summarizes the number of completed tracked actions.
 *
 * @param items - The tracked activity items to count
 * @returns A completion summary using singular wording for one item and plural wording for other counts
 */
export function activitySummary(items: AgentActivityItem[]) {
	return items.length === 1 ? "Completed 1 tracked action" : `Completed ${items.length} tracked actions`;
}
