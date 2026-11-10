/**
 * Browser-safe contract for the read-only tools that OpenUI `Query()` statements
 * may call.
 *
 * OpenUI 1.0 runs `Query("tool_name", {...args})` through the renderer's
 * `toolProvider`. Fleet does not let generated UI reach the runtime directly:
 * the browser posts `{ name, args }` to Fleet's own HTTP route, which dispatches
 * to the existing server handlers. This module owns the shared vocabulary so the
 * prompt, the browser tool map, and the server route cannot drift.
 *
 * Everything here is read-only by design. Mutations are deliberately absent: a
 * generated UI must not be able to write through the Fleet boundary without an
 * explicit, reviewed capability.
 */

import { z } from "zod";
import { SessionIdSchema } from "./fleet-contract";

/** Tool names a generated OpenUI program is allowed to call. */
export const OPENUI_TOOL_NAMES = [
	"workspace_tree",
	"list_sessions",
	"list_resources",
	"session_stats",
	"session_outputs",
] as const;

/** Preview length for one session output row. The full transcript is not returned. */
export const SESSION_OUTPUT_PREVIEW_LIMIT = 240;

export type OpenUIToolName = (typeof OPENUI_TOOL_NAMES)[number];

export const OpenUIToolNameSchema = z.enum(OPENUI_TOOL_NAMES);

/** Maximum number of rows any tool returns, so a generated table stays readable. */
export const OPENUI_TOOL_ROW_LIMIT = 200;

const LimitSchema = z
	.number()
	.int()
	.min(1)
	.max(OPENUI_TOOL_ROW_LIMIT)
	.optional()
	.describe(`Maximum rows to return (1-${OPENUI_TOOL_ROW_LIMIT}). Omit for a sensible default.`);

const DepthSchema = z
	.number()
	.int()
	.min(1)
	.max(4)
	.optional()
	.describe("Directory depth to include. Use 1 for a top-level overview.");

/**
 * A workspace-relative path. Absolute paths, traversal segments, and Windows
 * separators are rejected because tool args are untrusted model output.
 */
const WorkspaceRelativePathArgSchema = z
	.string()
	.min(1)
	.max(1024)
	.refine(
		(value) => !value.startsWith("/") && !value.includes("..") && !value.includes("\\"),
		"Path must be workspace-relative and must not contain '..' or a backslash.",
	)
	.describe("Workspace-relative directory to start from. Omit for the root.");

export const WorkspaceTreeToolArgsSchema = z.object({
	limit: LimitSchema,
	depth: DepthSchema,
	path: WorkspaceRelativePathArgSchema.optional(),
});

export const ListSessionsToolArgsSchema = z.object({
	limit: LimitSchema,
	status: z
		.enum(["running", "idle", "failed", "interrupted"])
		.optional()
		.describe(
			'Only include sessions in this state. These are the statuses Fleet reports; there is no "error" status.',
		),
	projectId: z.string().optional().describe("Only include sessions belonging to this project."),
});

export const ListResourcesToolArgsSchema = z.object({
	limit: LimitSchema,
	kind: z
		.enum(["skills", "prompts", "themes", "extensions", "packages", "agentsFiles"])
		.optional()
		.describe("Only include this resource kind."),
});

/** `session_stats` is an aggregate over the session list and takes no arguments. */
export const SessionStatsToolArgsSchema = z.object({});

/**
 * `session_outputs` reads the open session. The session id is a sibling of
 * `args` on the request, so a model-supplied session id is rejected.
 * A missing filter arrives as "" or null and is treated as unset.
 */
const SessionOutputLimitSchema = z.preprocess((value) => {
	if (value === "" || value === null || value === undefined) return undefined;
	if (typeof value === "string" && value.trim() !== "") return Number(value);
	return value;
}, LimitSchema);

export const SessionOutputsToolArgsSchema = z
	.object({
		limit: SessionOutputLimitSchema,
	})
	.strict();

/** Row shapes a generated program can pluck with dot notation (`rows.title`). */

export type WorkspaceTreeRow = {
	path: string;
	name: string;
	type: "file" | "directory";
	depth: number;
	children: number;
};

export type SessionRow = {
	sessionId: string;
	title: string;
	projectId: string;
	status: string;
	messageCount: number;
	createdAt: string;
	updatedAt: string;
};

export type ResourceRow = {
	name: string;
	kind: string;
	description: string;
};

export type SessionStatsRow = {
	status: string;
	sessions: number;
	messages: number;
};

export type SessionOutputRow = {
	turn: number;
	role: "user" | "assistant";
	kind: "text" | "tool";
	toolName: string;
	preview: string;
};

/** Returned when a dashboard already has subject figures, so chat rows cannot replace them. */
export const EMPTY_SESSION_OUTPUTS = {
	rows: [] as SessionOutputRow[],
	columns: {
		turn: [] as number[],
		role: [] as string[],
		kind: [] as string[],
		toolName: [] as string[],
		preview: [] as string[],
	},
	total: 0,
	toolCalls: 0,
};

/**
 * One tool as the prompt sees it. Mirrors the shape upstream `ToolSpec` expects,
 * so this object can be passed straight into `generatePrompt({ tools })`.
 */
export type OpenUIToolDescriptor = {
	name: OpenUIToolName;
	description: string;
	inputSchema: Record<string, unknown>;
	outputSchema: Record<string, unknown>;
};

const rowOutputSchema = (properties: Record<string, unknown>): Record<string, unknown> => ({
	type: "object",
	properties: {
		rows: {
			type: "array",
			items: { type: "object", properties },
		},
	},
	required: ["rows"],
});

const ROW_FIELDS = {
	list_sessions:
		"Each row has exactly these fields: sessionId, title, projectId, status, messageCount, createdAt, updatedAt. Use those exact keys as DataTable column keys.",
	workspace_tree:
		"Each row has exactly these fields: path, name, type, depth, children. Use those exact keys as DataTable column keys.",
	list_resources:
		"Each row has exactly these fields: name, kind, description. Use those exact keys as DataTable column keys.",
	session_stats:
		"Each row has exactly these fields: status, sessions, messages. Use those exact keys as DataTable column keys.",
	session_outputs:
		"Each row has exactly these fields: turn, role, kind, toolName, preview. Use those exact keys as DataTable column keys. kind is text or tool. Reasoning is not included. The response also carries `total`, the row count before the limit was applied; use `total` for a session-wide count and `rows` for what is displayed.",
} as const;

/** Tool descriptions are prompt text: they name the exact row fields, because a
 * generated DataTable that guesses column keys renders blank cells. */
export const OPENUI_TOOL_DESCRIPTORS: readonly OpenUIToolDescriptor[] = [
	{
		name: "workspace_tree",
		description: `Lists files and directories in the current workspace. ${ROW_FIELDS.workspace_tree} Use it for file inventories and project structure summaries.`,
		inputSchema: z.toJSONSchema(WorkspaceTreeToolArgsSchema) as Record<string, unknown>,
		outputSchema: rowOutputSchema({
			path: { type: "string" },
			name: { type: "string" },
			type: { type: "string", enum: ["file", "directory"] },
			depth: { type: "number" },
			children: { type: "number" },
		}),
	},
	{
		name: "list_sessions",
		description: `Lists Fleet chat sessions, newest first. ${ROW_FIELDS.list_sessions} Use it for activity dashboards and recent-work tables.`,
		inputSchema: z.toJSONSchema(ListSessionsToolArgsSchema) as Record<string, unknown>,
		outputSchema: rowOutputSchema({
			sessionId: { type: "string" },
			title: { type: "string" },
			projectId: { type: "string" },
			status: { type: "string" },
			messageCount: { type: "number" },
			createdAt: { type: "string" },
			updatedAt: { type: "string" },
		}),
	},
	{
		name: "list_resources",
		description: `Lists installed Prime Agent resources (skills, prompts, themes, extensions, packages, agents files). ${ROW_FIELDS.list_resources} Use it to show what capabilities are available.`,
		inputSchema: z.toJSONSchema(ListResourcesToolArgsSchema) as Record<string, unknown>,
		outputSchema: rowOutputSchema({
			name: { type: "string" },
			kind: { type: "string" },
			description: { type: "string" },
		}),
	},
	{
		name: "session_stats",
		description: `Aggregates the session list into one row per status. ${ROW_FIELDS.session_stats} Use it for KPI cards instead of fetching every session and counting in the program.`,
		inputSchema: { type: "object", properties: {} },
		outputSchema: rowOutputSchema({
			status: { type: "string" },
			sessions: { type: "number" },
			messages: { type: "number" },
		}),
	},
	{
		name: "session_outputs",
		description: `Reads the open Fleet session's text and tool outputs, oldest first. ${ROW_FIELDS.session_outputs} The session is chosen by Fleet, not by an argument. Use it for a dashboard of this session.`,
		inputSchema: z.toJSONSchema(SessionOutputsToolArgsSchema) as Record<string, unknown>,
		outputSchema: rowOutputSchema({
			turn: { type: "number" },
			role: { type: "string", enum: ["user", "assistant"] },
			kind: { type: "string", enum: ["text", "tool"] },
			toolName: { type: "string" },
			preview: { type: "string" },
		}),
	},
];

export const OpenUIToolRequestSchema = z.object({
	name: OpenUIToolNameSchema,
	args: z.unknown().optional(),
	/** The open Fleet session. Ignored by every tool except `session_outputs`. */
	sessionId: SessionIdSchema.optional(),
});

export type OpenUIToolRequest = z.infer<typeof OpenUIToolRequestSchema>;

export const OpenUIToolResponseSchema = z.object({
	ok: z.boolean(),
	rows: z.array(z.record(z.string(), z.unknown())).optional(),
	/** Row count before paging. Absent when a tool truncates rather than pages. */
	total: z.number().int().nonnegative().optional(),
	/**
	 * Per-column primitive arrays for `Table([Col(...)])`.
	 *
	 * `Col` binds one column of values, and openui-lang has no projection
	 * builtin, so a component cannot derive a column from `rows`. Tools that feed
	 * a table return this projection alongside the rows.
	 */
	columns: z.record(z.string(), z.array(z.unknown())).optional(),
	/** Session-wide count, independent of the page size a table displays. */
	toolCalls: z.number().int().nonnegative().optional(),
	message: z.string().optional(),
});

export type OpenUIToolResponse = z.infer<typeof OpenUIToolResponseSchema>;

/**
 * Validates `args` for one tool. Returns `undefined` when the tool takes none.
 * Callers treat a failure as a 400 rather than passing unvalidated input through.
 */
export function parseOpenUIToolArgs(name: OpenUIToolName, args: unknown) {
	const schema = {
		workspace_tree: WorkspaceTreeToolArgsSchema,
		list_sessions: ListSessionsToolArgsSchema,
		list_resources: ListResourcesToolArgsSchema,
		session_stats: SessionStatsToolArgsSchema,
		session_outputs: SessionOutputsToolArgsSchema,
	}[name];

	return schema.parse(args ?? {});
}

export const DEFAULT_OPENUI_TOOL_LIMIT = 50;
