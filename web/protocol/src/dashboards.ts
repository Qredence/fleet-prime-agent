/**
 * Browser-safe dashboard contract.
 *
 * The Thesys key never appears here. Callers learn only whether a key is
 * configured and which side supplied it.
 */
import { z } from "./schemas/shared";

export const DashboardModeSchema = z.enum(["cloud", "self-hosted"]);
export type DashboardMode = z.infer<typeof DashboardModeSchema>;

export const DashboardKeySourceSchema = z.enum(["settings", "environment", "none"]);
export type DashboardKeySource = z.infer<typeof DashboardKeySourceSchema>;

export const DashboardStatusSchema = z.object({
	configured: z.boolean(),
	keySource: DashboardKeySourceSchema,
	mode: DashboardModeSchema,
	/**
	 * The `provider/model` that builds cloud dashboards. A model id is not a
	 * secret, and the browser needs it to explain which provider BYOK covers.
	 */
	model: z.string(),
	/** Where the model came from, so Settings can say what an override replaces. */
	modelSource: z.enum(["settings", "environment", "default"]),
});
export type DashboardStatus = z.infer<typeof DashboardStatusSchema>;

/**
 * Write-only dashboard settings. `null` clears a stored value and falls back to
 * the environment, then to the built-in default. Omitted fields are untouched.
 */
export const DashboardSettingsUpdateSchema = z.object({
	apiKey: z.string().nullable().optional(),
	model: z.string().trim().min(1).max(200).nullable().optional(),
});
export type DashboardSettingsUpdate = z.infer<typeof DashboardSettingsUpdateSchema>;

/** Figures the assistant copied from the conversation. A board charts these and does not invent more. */
export const DASHBOARD_COLUMN_LIMIT = 12;
export const DASHBOARD_ROW_LIMIT = 200;
const DASHBOARD_CELL_LIMIT = 500;

const DASHBOARD_COLUMN_TYPE_ALIASES = ["string", "number", "text", "currency", "percent"] as const;

/** OpenUI DataTable says text/currency/percent. Fence storage is only string or number. */
function canonicalColumnType(value: (typeof DASHBOARD_COLUMN_TYPE_ALIASES)[number] | undefined): "string" | "number" {
	switch (value) {
		case undefined:
		case "string":
		case "text":
			return "string";
		case "number":
		case "currency":
		case "percent":
			return "number";
		default: {
			const exhaustive: never = value;
			return exhaustive;
		}
	}
}

export const DashboardColumnSchema = z.object({
	key: z
		.string()
		.trim()
		.min(1)
		.max(64)
		.regex(/^[A-Za-z][A-Za-z0-9_]*$/),
	label: z.string().trim().min(1).max(80),
	/** Omitted type, and OpenUI's `text`, mean string. `currency` and `percent` mean number. */
	type: z.enum(DASHBOARD_COLUMN_TYPE_ALIASES).optional().transform(canonicalColumnType),
});
export type DashboardColumn = z.infer<typeof DashboardColumnSchema>;

const DashboardCellSchema = z.union([z.string(), z.number(), z.null()]);

export const DashboardDatasetSchema = z
	.object({
		columns: z.array(DashboardColumnSchema).min(1).max(DASHBOARD_COLUMN_LIMIT),
		rows: z.array(z.record(z.string(), DashboardCellSchema)).max(DASHBOARD_ROW_LIMIT),
	})
	.superRefine((dataset, ctx) => {
		const keys = dataset.columns.map((column) => column.key);
		if (new Set(keys).size !== keys.length) {
			ctx.addIssue({ code: "custom", message: "Column keys must be unique." });
		}
		dataset.rows.forEach((row, index) => {
			for (const column of dataset.columns) {
				const value = row[column.key];
				if (value === undefined || value === null) continue;
				if (column.type === "number" && typeof value !== "number") {
					ctx.addIssue({
						code: "custom",
						message: `Row ${index} column ${column.key} must be a number.`,
					});
				}
				if (column.type === "string" && typeof value !== "string") {
					ctx.addIssue({
						code: "custom",
						message: `Row ${index} column ${column.key} must be a string.`,
					});
				}
			}
		});
	})
	.transform((dataset) => ({
		columns: dataset.columns,
		rows: dataset.rows.map((row) => {
			const projected: Record<string, string | number | null> = {};
			for (const column of dataset.columns) {
				const value = row[column.key];
				if (typeof value === "string") projected[column.key] = value.slice(0, DASHBOARD_CELL_LIMIT);
				else projected[column.key] = value ?? null;
			}
			return projected;
		}),
	}));
export type DashboardDataset = z.infer<typeof DashboardDatasetSchema>;

/** The shape `dashboard_rows` returns. `columnValues` is one array per column key, which `Col` can bind. */
export function projectDashboardDataset(dataset: DashboardDataset | undefined): {
	columns: DashboardColumn[];
	rows: Array<Record<string, string | number | null>>;
	columnValues: Record<string, Array<string | number | null>>;
} {
	const columns = dataset?.columns ?? [];
	const rows = dataset?.rows ?? [];
	const columnValues: Record<string, Array<string | number | null>> = {};
	for (const column of columns) {
		columnValues[column.key] = rows.map((row) => row[column.key] ?? null);
	}
	return { columns, rows, columnValues };
}

/**
 * A dashboard stored on the session.
 *
 * `response` is the opaque Cloud builder result and is passed to the renderer unchanged.
 * A local board stores `program` instead. `dataset` is what `dashboard_rows` serves.
 * A failure records `error` and leaves `response` unset, so a failed create does
 * not substitute another board. An edit failure sets `error` and keeps `response`.
 */
export const DashboardRecordSchema = z.object({
	mode: z.enum(["cloud", "local"]),
	response: z.string().optional(),
	dashboardId: z.string().optional(),
	program: z.string().min(1).max(200_000).optional(),
	dataset: DashboardDatasetSchema.optional(),
	error: z.string().max(400).optional(),
	/** Stable identity of the fence that created the board, so a reload finds it. */
	fenceKey: z.string().min(1).max(64),
	/** Messages already settled, so a replay does not call the builder again. */
	settledMessageIds: z.array(z.string().min(1).max(200)).max(50).optional(),
});
export type DashboardRecord = z.infer<typeof DashboardRecordSchema>;

/**
 * OpenUI's recommended model for building dashboards. Used when neither a saved
 * setting nor the server environment selects one.
 */
export const DEFAULT_DASHBOARD_MODEL = "anthropic/claude-sonnet-5.5";

/**
 * Suggestions for the Settings field. These ids were present on the live
 * Gateway catalog. They are non-binding: any `{provider}/{model}` the Gateway
 * serves can be saved.
 *
 * Every entry must be provider-qualified. A bare model name is rejected by the
 * Gateway, so a suggestion without a provider is a trap.
 */
export const DASHBOARD_MODEL_SUGGESTIONS = [
	DEFAULT_DASHBOARD_MODEL,
	"openai/gpt-6-luna",
	"openai/gpt-6-sol",
	"google/gemini-4-argon",
] as const;

const DASHBOARD_FENCE = /```openui-dashboard[ \t]*\r?\n([\s\S]*?)```/g;

export type DashboardFence = {
	title?: string;
	/** Cloud create or edit. The server calls the builder once. */
	prompt?: string;
	/** Cloud dashboard id. Present on an edit. */
	id?: string;
	/** Dashboard-library program. Drawn locally, with no Cloud call. */
	program?: string;
	/** Figures already written in the conversation. Served as `dashboard_rows`. */
	dataset?: DashboardDataset;
};

const DashboardFenceSchema = z
	.object({
		title: z.string().trim().min(1).max(120).optional(),
		prompt: z.string().trim().min(1).max(8000).optional(),
		id: z.string().trim().min(1).max(200).optional(),
		program: z.string().trim().min(1).max(200_000).optional(),
		columns: z.array(DashboardColumnSchema).max(DASHBOARD_COLUMN_LIMIT).optional(),
		rows: z.array(z.record(z.string(), DashboardCellSchema)).max(DASHBOARD_ROW_LIMIT).optional(),
	})
	.superRefine((value, ctx) => {
		if (!value.prompt && !value.program) {
			ctx.addIssue({ code: "custom", message: "A dashboard fence needs a prompt or a program." });
		}
		if (value.rows && !value.columns) {
			ctx.addIssue({ code: "custom", message: "Rows need columns." });
		}
		if (!value.columns) return;
		const dataset = DashboardDatasetSchema.safeParse({ columns: value.columns, rows: value.rows ?? [] });
		if (!dataset.success) {
			for (const issue of dataset.error.issues) {
				ctx.addIssue({ code: "custom", message: issue.message });
			}
		}
	});

/** Completed dashboard fences in a message. Incomplete fences while streaming are skipped. */
export function dashboardFences(content: string): DashboardFence[] {
	const fences: DashboardFence[] = [];
	for (const match of content.matchAll(DASHBOARD_FENCE)) {
		const parsed = parseDashboardFence(match[1] ?? "");
		if (parsed) fences.push(parsed);
	}
	return fences;
}

export function stripDashboardFences(content: string): string {
	return content.replace(new RegExp(DASHBOARD_FENCE.source, "g"), "").trim();
}

export function parseDashboardFence(body: string): DashboardFence | undefined {
	try {
		const parsed = DashboardFenceSchema.safeParse(JSON.parse(body));
		if (!parsed.success) return undefined;
		const { columns, rows, title, prompt, id, program } = parsed.data;
		const dataset = columns ? DashboardDatasetSchema.parse({ columns, rows: rows ?? [] }) : undefined;
		return {
			...(title ? { title } : {}),
			...(prompt ? { prompt } : {}),
			...(id ? { id } : {}),
			...(program ? { program } : {}),
			...(dataset ? { dataset } : {}),
		};
	} catch {
		return undefined;
	}
}

/**
 * Identity of a fence, shared by the server and the transcript card.
 * The same fence text maps to the same key after a reload.
 */
export function dashboardFenceKey(fence: DashboardFence): string {
	const canonical = JSON.stringify({
		title: fence.title ?? "",
		prompt: fence.prompt ?? "",
		id: fence.id ?? "",
		program: fence.program ?? "",
		dataset: fence.dataset ?? null,
	});
	let high = 0x811c9dc5;
	let low = 0x01000193;
	for (let index = 0; index < canonical.length; index += 1) {
		const code = canonical.charCodeAt(index);
		high ^= code;
		high = Math.imul(high, 0x01000193);
		low ^= code;
		low = Math.imul(low, 0x811c9dc5);
	}
	const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");
	return `${hex(high)}${hex(low)}`;
}

/**
 * Cloud create/edit responses name the artifact in `artifact_id`.
 * The rest of the response stays opaque, including any earlier `art_` token.
 */
export function dashboardIdFromResponse(response: string): string | undefined {
	return /(?:^|[?&])artifact_id=(art_[A-Za-z0-9_-]+)/.exec(response)?.[1];
}
