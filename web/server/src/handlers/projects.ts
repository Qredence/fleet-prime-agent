import {
	ProjectCreateRequestSchema,
	ProjectForkRequestSchema,
	ProjectIdSchema,
	ProjectRenameRequestSchema,
	redactSessionLabelSecrets,
} from "@prime-agent/web-protocol";
import type { SessionSummary } from "prime-agent";
import type { BridgeSession } from "../prime-bridge";
import { getPrimeConfig } from "../prime-config";
import { normalizeSessionListRow } from "../session-list";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

export function sessionStatus(
	info: Partial<Pick<SessionSummary, "activity" | "isSessionActive" | "isStreaming">> & {
		state?: { status?: string };
	},
	live: BridgeSession | undefined,
) {
	if (live?.isStreaming || live?.session?.isStreaming || info.isStreaming) {
		return "running" as const;
	}
	// Restored daemon workers report activity "working" while the session was
	// never activated (isSessionActive false); nothing can run in that state.
	if (info.activity === "working" && info.isSessionActive) {
		return "running" as const;
	}
	if (info.state?.status === "crash") return "failed" as const;
	return live || info.isSessionActive ? ("idle" as const) : ("interrupted" as const);
}

async function sessionProjectIds() {
	const bridge = getBridge();
	const sessions = await bridge.listSessions();
	const registry = getPrimeConfig().projectRegistry;
	const assignmentEntries = await Promise.all(
		sessions.map(async (source) => {
			const session = normalizeSessionListRow(source);
			return [
				session.sessionId,
				await registry.projectIdForSession(
					session.sessionId,
					bridge.getSession(session.sessionId)?.cwd ?? session.cwd,
				),
			] as const;
		}),
	);
	const assignments = new Map(assignmentEntries);
	return { bridge, sessions, assignments };
}

export function handleProjectsGet(_request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const { sessions, assignments } = await sessionProjectIds();
		const counts = new Map<string, number>();
		for (const projectId of assignments.values()) {
			if (projectId) counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
		}
		return Response.json({
			projects: await getPrimeConfig().projectRegistry.list(counts),
			sessions: sessions.map((source) => {
				const session = normalizeSessionListRow(source);
				return {
					sessionId: session.sessionId,
					projectId: assignments.get(session.sessionId) ?? null,
					title: redactSessionLabelSecrets(session.title || session.firstMessage || session.sessionId.slice(0, 8)),
					createdAt: session.createdAt,
					updatedAt: session.updatedAt,
					status: sessionStatus(session.source, getBridge().getSession(session.sessionId)),
					messageCount: session.messageCount,
					firstMessage: session.firstMessage ? redactSessionLabelSecrets(session.firstMessage) : "",
				};
			}),
		});
	});
}

export function handleProjectsPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ProjectCreateRequestSchema.parse(await request.json().catch(() => ({})));
		const registry = getPrimeConfig().projectRegistry;
		const path = await registry.resolveDirectoryInput(body);
		return Response.json({ project: await registry.register(path, body.name) }, { status: 201 });
	});
}

export function handleProjectPatch(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const projectId = ProjectIdSchema.parse(new URL(request.url).searchParams.get("projectId") ?? "");
		const body = ProjectRenameRequestSchema.parse(await request.json().catch(() => ({})));
		return Response.json({ project: await getPrimeConfig().projectRegistry.rename(projectId, body.name) });
	});
}

export function handleProjectDelete(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const projectId = ProjectIdSchema.parse(new URL(request.url).searchParams.get("projectId") ?? "");
		return Response.json({ project: await getPrimeConfig().projectRegistry.unregister(projectId) });
	});
}

export function handleProjectSessionFork(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ProjectForkRequestSchema.parse(await request.json().catch(() => ({})));
		const sessionId = await getBridge().forkSessionIntoProject(body.sessionId, body.targetProjectId);
		return Response.json({ sessionId, projectId: body.targetProjectId }, { status: 201 });
	});
}

export function handleProjectBrowseGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const url = new URL(request.url);
		const result = await getPrimeConfig().projectRegistry.browse({
			path: url.searchParams.get("path") ?? undefined,
			token: url.searchParams.get("token") ?? undefined,
		});
		return Response.json(result);
	});
}
