import { type OpenPanelAction, OpenPanelActionSchema } from "@prime-agent/web-protocol/fleet-contract";

const OPEN_PANEL_ACTION_PREFIX = "fleet-prime:open-panel:";

export function encodeOpenPanelActionMessage(action: OpenPanelAction): string {
	return `${OPEN_PANEL_ACTION_PREFIX}${JSON.stringify(action)}`;
}

export function decodeOpenPanelActionMessage(message: string): OpenPanelAction | undefined {
	if (!message.startsWith(OPEN_PANEL_ACTION_PREFIX)) return undefined;
	try {
		return OpenPanelActionSchema.parse(JSON.parse(message.slice(OPEN_PANEL_ACTION_PREFIX.length)));
	} catch {
		return undefined;
	}
}
