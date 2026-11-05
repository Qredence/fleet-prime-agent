import { type OpenPanelAction, OpenPanelActionSchema } from "@prime-agent/web-protocol/fleet-contract";

const OPEN_PANEL_ACTION_PREFIX = "fleet-prime:open-panel:";

/** Name of the library-defined action that opens a Fleet panel. */
export const OPEN_PANEL_ACTION_NAME = "OpenPanel";

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

/**
 * Validates the params of an `@OpenPanel(...)` action step into the same shape
 * the panel component emits, so both the action and the component reach the
 * panel layer through one validated path.
 */
export function openPanelActionFromParams(params: unknown): OpenPanelAction | undefined {
	if (typeof params !== "object" || params === null) return undefined;
	const candidate = params as { panel?: unknown; relativePath?: unknown; focus?: unknown };
	const parsed = OpenPanelActionSchema.safeParse({
		panel: candidate.panel,
		// `relativePath` may arrive as `undefined` or omitted; drop the key rather
		// than passing an explicit undefined through schema strictness.
		...(candidate.relativePath === undefined || candidate.relativePath === null
			? {}
			: { relativePath: candidate.relativePath }),
		...(candidate.focus === undefined ? {} : { focus: candidate.focus }),
	});
	return parsed.success ? parsed.data : undefined;
}
