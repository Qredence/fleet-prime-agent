/**
 * OpenUI Cloud dashboard client.
 *
 * The API key stays in this module's constructor argument. Tests replace the
 * service so no test constructs a live client or reads `web/app/.env`.
 */
import {
	type Dashboard,
	type DataTool,
	type ExecutionContext,
	OpenUIClient,
	ToolExecutionError,
} from "@openuidev/server";
import {
	type DashboardDataset,
	DEFAULT_DASHBOARD_MODEL,
	projectDashboardDataset,
} from "@prime-agent/web-protocol/dashboards";
import { EMPTY_SESSION_OUTPUTS, OPENUI_TOOL_ROW_LIMIT } from "@prime-agent/web-protocol/openui-tools";
import { requireSession } from "../handlers/session-access";
import { getBridge } from "../singleton";
import { resolveDashboardModel, resolveThesysApiKey } from "./credentials";
import librarySpec from "./library-spec.json" with { type: "json" };
import { pageSessionOutputs } from "./session-outputs";

export type DashboardContext = ExecutionContext & {
	sessionId: string;
	dashboardId?: string;
	dataset?: DashboardDataset;
};

export type DashboardService = {
	create: Dashboard<DashboardContext>["create"];
	edit: Dashboard<DashboardContext>["edit"];
	interpreter: Dashboard<DashboardContext>["interpreter"];
	createFrontendToken: OpenUIClient["createFrontendToken"];
};

type SpecFile = {
	spec: Parameters<OpenUIClient["defineDashboard"]>[0]["library"];
	promptOptions: {
		preamble?: string;
		examples?: string[];
		additionalRules?: string[];
	};
};

const specFile = librarySpec as SpecFile;

function clampLimit(value: unknown): number {
	const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
	if (typeof parsed !== "number" || !Number.isFinite(parsed)) return 40;
	return Math.min(Math.max(Math.trunc(parsed), 1), OPENUI_TOOL_ROW_LIMIT);
}

const dashboardRowsTool: DataTool<DashboardContext> = {
	description:
		"Figures Prime Agent already wrote for this dashboard. columnValues holds one array per column key. Chart those values. Leave a section empty when a figure is absent. This is the only source of subject facts.",
	parameters: { type: "object", properties: {} },
	output: { columns: [], rows: [], columnValues: {} },
	execute: async (_args, context) => projectDashboardDataset(context.dataset),
};

const sessionOutputsTool: DataTool<DashboardContext> = {
	description:
		"This chat's own activity, oldest first. Reasoning is omitted and preview is truncated. Empty when dashboard_rows has figures, so it cannot replace those figures. It is not a source of subject facts.",
	parameters: {
		type: "object",
		properties: {
			limit: { type: "number", description: "Maximum rows. Empty or null means the default." },
		},
	},
	output: {
		rows: [{ turn: 1, role: "assistant", kind: "tool", toolName: "read", preview: "src/main.ts" }],
		columns: {
			turn: [1],
			role: ["assistant"],
			kind: ["tool"],
			toolName: ["read"],
			preview: ["src/main.ts"],
		},
		total: 1,
		toolCalls: 1,
	},
	execute: async (args, context, { signal }) => {
		// The dashboard request can end or exhaust its time budget mid-fetch. The
		// connection port takes no signal, so abort is checked at each step rather
		// than being threaded into getMessages.
		signal?.throwIfAborted();
		// Subject figures already live on dashboard_rows. Returning the chat here
		// would let truncated tool previews replace them.
		if ((context.dataset?.rows.length ?? 0) > 0) return EMPTY_SESSION_OUTPUTS;
		const session = await requireSession(context.sessionId);
		if (!session) throw new ToolExecutionError("Unknown session.", "session_not_found", 404);
		signal?.throwIfAborted();
		const messages = await getBridge().getMessages(context.sessionId);
		signal?.throwIfAborted();
		return pageSessionOutputs(messages, clampLimit(args.limit));
	},
};

let override: DashboardService | null = null;

/** Test seam. Pass null to use the real client again. */
export function setDashboardServiceForTests(service: DashboardService | null): void {
	override = service;
}

export function createDashboardService(apiKey: string, model: string = DEFAULT_DASHBOARD_MODEL): DashboardService {
	const client = new OpenUIClient({ apiKey });
	const dashboards = client.defineDashboard<DashboardContext>({
		library: specFile.spec,
		model,
		tools: { dashboard_rows: dashboardRowsTool, session_outputs: sessionOutputsTool },
		promptOptions: {
			preamble:
				`${specFile.promptOptions.preamble ?? ""} Lay out the figures Prime Agent already collected. Chart dashboard_rows. Leave a section empty when those rows do not have the figure. Do not research, and do not treat session_outputs as subject data. Use session_outputs only when dashboard_rows is empty, for a dashboard of this chat.`.trim(),
			examples: specFile.promptOptions.examples,
			additionalRules: [
				...(specFile.promptOptions.additionalRules ?? []).filter((rule) => !/placeholder data/i.test(rule)),
				"Lay out dashboard_rows. Leave a section empty when those rows do not have the figure. Do not research. session_outputs is this chat's activity and is empty when dashboard_rows has figures.",
			],
		},
	});
	return {
		create: (params, context, options) => dashboards.create(params, context, options),
		edit: (params, context, options) => dashboards.edit(params, context, options),
		interpreter: dashboards.interpreter,
		createFrontendToken: (params, options) => client.createFrontendToken(params, options),
	};
}

export function dashboardServiceForKey(apiKey: string | undefined, model?: string): DashboardService | null {
	if (override) return override;
	if (!apiKey) return null;
	return createDashboardService(apiKey, model);
}

export async function configuredDashboardService(): Promise<DashboardService | null> {
	const apiKey = await resolveThesysApiKey();
	const { model } = await resolveDashboardModel();
	return dashboardServiceForKey(apiKey, model);
}
