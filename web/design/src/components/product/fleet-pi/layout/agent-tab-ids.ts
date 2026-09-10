/**
 * Creates a deterministic ARIA ID for an agent tab trigger.
 *
 * @param tabId - The tab identifier to encode
 * @returns The encoded tab trigger ID
 */
export function agentTabTriggerId(tabId: string) {
	return `agent-tab-${encodeURIComponent(tabId)}`;
}

/**
 * Generates the ARIA ID for an agent tab panel.
 *
 * @param tabId - The tab identifier to encode in the panel ID
 * @returns The encoded agent tab panel ID
 */
export function agentTabPanelId(tabId: string) {
	return `agent-tab-panel-${encodeURIComponent(tabId)}`;
}
