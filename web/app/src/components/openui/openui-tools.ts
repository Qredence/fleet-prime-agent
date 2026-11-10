import { OPENUI_TOOL_NAMES, type OpenUIToolName, OpenUIToolResponseSchema } from "@prime-agent/web-protocol";

/**
 * Browser side of the OpenUI tool surface.
 *
 * The renderer runs `Query("name", args)` through this map. Each call posts to
 * Fleet's own route, so the browser never talks to the runtime and the request
 * keeps Fleet's origin guard and error envelope.
 *
 */

export const OPENUI_TOOL_ENDPOINT = "/api/chat/openui/tool";

async function callTool(
	name: OpenUIToolName,
	args: Record<string, unknown>,
	projectId?: string,
	sessionId?: string,
): Promise<unknown> {
	const response = await fetch(
		projectId ? `${OPENUI_TOOL_ENDPOINT}?${new URLSearchParams({ projectId })}` : OPENUI_TOOL_ENDPOINT,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, args, ...(sessionId ? { sessionId } : {}) }),
		},
	);

	if (!response.ok) {
		// Surfacing the status keeps a failing tool visible in OpenUI's diagnostics
		// instead of silently rendering the query's default value forever.
		throw new Error(`OpenUI tool "${name}" failed with status ${response.status}.`);
	}

	const parsed = OpenUIToolResponseSchema.safeParse(await response.json());
	if (!parsed.success) throw new Error(`OpenUI tool "${name}" returned an unexpected payload.`);
	if (!parsed.data.ok) throw new Error(parsed.data.message ?? `OpenUI tool "${name}" failed.`);

	// Pass the envelope through instead of narrowing it to rows. A table binds
	// `outputs.columns.<field>`, and dropping `columns` here left every cell
	// blank even though the server had returned the data.
	return {
		rows: parsed.data.rows ?? [],
		...(parsed.data.columns === undefined ? {} : { columns: parsed.data.columns }),
		...(parsed.data.total === undefined ? {} : { total: parsed.data.total }),
		...(parsed.data.toolCalls === undefined ? {} : { toolCalls: parsed.data.toolCalls }),
	};
}

/** Dashboards query this conversation only. Chat OpenUI keeps the wider tool map. */
export function createSessionOutputsToolProvider(
	projectId?: string,
	sessionId?: string,
): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
	return {
		session_outputs: (args) => callTool("session_outputs", args ?? {}, projectId, sessionId),
	};
}

export function createOpenUIToolProvider(
	projectId?: string,
	sessionId?: string,
): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
	return Object.fromEntries(
		OPENUI_TOOL_NAMES.map((name) => [
			name,
			(args: Record<string, unknown>) => callTool(name, args ?? {}, projectId, sessionId),
		]),
	);
}
