import { type OpenPanelAction, OpenPanelActionSchema } from "@prime-agent/web-protocol/fleet-contract";

/** Name of the library-defined action that opens a Fleet panel. */
export const OPEN_PANEL_ACTION_NAME = "OpenPanel";

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
