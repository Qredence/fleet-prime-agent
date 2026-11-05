import {
	DEFAULT_OPENUI_TOOL_LIMIT,
	OPENUI_TOOL_ROW_LIMIT,
	type OpenUIToolName,
	OpenUIToolRequestSchema,
	parseOpenUIToolArgs,
	type ResourceRow,
	type SessionRow,
	type SessionStatsRow,
	type WorkspaceTreeRow,
} from "@prime-agent/web-protocol";
import { wrapApiHandler } from "../wrap-api-handler";
import { handleChatResourcesGet } from "./chat-resources";
import { handleChatSessionsGet } from "./chat-sessions";
import { handleWorkspaceTreeGet } from "./workspace-tree";

/**
 * Read-only tool surface for OpenUI `Query()` statements. Dispatch lives here so
 * `web/app` carries no runtime knowledge and the browser never receives a raw
 * runtime object. There is no mutation path: generated UI must not write.
 */

type ToolBudget = { readonly limit: number };

type TreeNode = {
	name: string;
	path: string;
	type: "file" | "directory";
	children?: TreeNode[];
};

function clampLimit(limit: number | undefined): number {
	if (limit === undefined) return DEFAULT_OPENUI_TOOL_LIMIT;
	return Math.min(Math.max(limit, 1), OPENUI_TOOL_ROW_LIMIT);
}

/** Flattens the nested workspace tree into rows a generated table can pluck. */
function flattenTree(nodes: readonly TreeNode[], maxDepth: number): WorkspaceTreeRow[] {
	const rows: WorkspaceTreeRow[] = [];
	const walk = (list: readonly TreeNode[], depth: number) => {
		for (const node of list) {
			const children = node.children?.length ?? 0;
			rows.push({ path: node.path, name: node.name, type: node.type, depth, children });
			if (node.type === "directory" && node.children && depth < maxDepth) {
				walk(node.children, depth + 1);
			}
		}
	};
	walk(nodes, 1);
	return rows;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
	const value = await response.json();
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

async function requireOk(response: Response, tool: string): Promise<Record<string, unknown>> {
	if (!response.ok) {
		throw Object.assign(new Error(`OpenUI tool ${tool} failed with status ${response.status}.`), {
			status: response.status,
		});
	}
	return readJson(response);
}

/**
 * Forwards the original request headers (so per-session cwd resolution still
 * works) while pinning the method and query string for an internal read.
 */
function readRequest(request: Request, params?: Record<string, string>): Request {
	const url = new URL(request.url);
	url.search = "";
	for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
	return new Request(url, { method: "GET", headers: request.headers });
}

async function workspaceTreeTool(request: Request, budget: ToolBudget, args: { depth?: number; path?: string }) {
	const tree = await requireOk(await handleWorkspaceTreeGet(readRequest(request)), "workspace_tree");
	const allNodes = Array.isArray(tree.nodes) ? (tree.nodes as TreeNode[]) : [];
	const nodes = args.path ? findSubtree(allNodes, args.path.replace(/\/+$/, "")) : allNodes;
	const depth = Math.min(Math.max(args.depth ?? 2, 1), 4);
	return { rows: flattenTree(nodes, depth).slice(0, budget.limit) };
}

/**
 * Resolves a workspace-relative path to its node in the already-read tree.
 * Returning nothing (rather than a broader tree) keeps a wrong or unknown path
 * from silently widening the result the model asked to narrow.
 */
function findSubtree(nodes: readonly TreeNode[], target: string): TreeNode[] {
	for (const node of nodes) {
		if (node.path === target) return node.children ?? [];
		if (target.startsWith(`${node.path}/`) && node.children) {
			const nested = findSubtree(node.children, target);
			if (nested.length > 0) return nested;
		}
	}
	return [];
}

async function listSessionsTool(request: Request, budget: ToolBudget, args: { status?: string; projectId?: string }) {
	const payload = await requireOk(
		await handleChatSessionsGet(readRequest(request, args.projectId ? { projectId: args.projectId } : undefined)),
		"list_sessions",
	);
	const sessions = Array.isArray(payload.sessions) ? (payload.sessions as Record<string, unknown>[]) : [];
	const rows: SessionRow[] = sessions
		.filter((session) => (args.status ? session.status === args.status : true))
		.map((session) => ({
			sessionId: String(session.sessionId ?? ""),
			title: String(session.title ?? ""),
			projectId: String(session.projectId ?? ""),
			status: String(session.status ?? ""),
			messageCount: Number(session.messageCount ?? 0),
			createdAt: String(session.createdAt ?? ""),
			updatedAt: String(session.updatedAt ?? ""),
		}));
	rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	return { rows: rows.slice(0, budget.limit) };
}

async function listResourcesTool(request: Request, budget: ToolBudget, args: { kind?: string }) {
	const payload = await requireOk(await handleChatResourcesGet(readRequest(request)), "list_resources");
	const rows: ResourceRow[] = [];
	for (const kind of ["skills", "prompts", "themes", "extensions", "packages", "agentsFiles"] as const) {
		if (args.kind && args.kind !== kind) continue;
		const entries = Array.isArray(payload[kind]) ? (payload[kind] as Record<string, unknown>[]) : [];
		for (const entry of entries) {
			rows.push({
				name: String(entry.name ?? ""),
				kind,
				description: String(entry.description ?? ""),
			});
		}
	}
	return { rows: rows.slice(0, budget.limit) };
}

async function sessionStatsTool(request: Request) {
	const payload = await requireOk(await handleChatSessionsGet(readRequest(request)), "session_stats");
	const sessions = Array.isArray(payload.sessions) ? (payload.sessions as Record<string, unknown>[]) : [];
	const byStatus = new Map<string, SessionStatsRow>();
	for (const session of sessions) {
		const status = String(session.status ?? "unknown");
		const current = byStatus.get(status) ?? { status, sessions: 0, messages: 0 };
		current.sessions += 1;
		current.messages += Number(session.messageCount ?? 0);
		byStatus.set(status, current);
	}
	return { rows: [...byStatus.values()].sort((a, b) => b.sessions - a.sessions) };
}

export function handleOpenUIToolPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const parsed = OpenUIToolRequestSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return Response.json({ ok: false, message: "Unknown or malformed OpenUI tool request." }, { status: 400 });
		}

		const { name } = parsed.data;
		const toolArgs = parseOpenUIToolArgs(name, parsed.data.args);
		const args = toolArgs as Record<string, unknown>;
		const budget: ToolBudget = { limit: clampLimit(args.limit as number | undefined) };

		const dispatch: Record<OpenUIToolName, () => Promise<{ rows: unknown[] }>> = {
			workspace_tree: () => workspaceTreeTool(request, budget, args),
			list_sessions: () => listSessionsTool(request, budget, args),
			list_resources: () => listResourcesTool(request, budget, args),
			session_stats: () => sessionStatsTool(request),
		};

		const result = await dispatch[name]();
		return Response.json({ ok: true, rows: result.rows });
	}, request);
}
