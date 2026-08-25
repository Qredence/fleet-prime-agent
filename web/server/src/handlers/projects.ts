import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import {
	ProjectCreateRequestSchema,
	ProjectForkRequestSchema,
	ProjectIdSchema,
	ProjectRenameRequestSchema,
	redactSessionLabelSecrets,
} from "@prime-agent/web-protocol";
import type { BridgeSession } from "../prime-bridge";
import { getPrimeConfig } from "../prime-config";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

export function sessionStatus(info: Pick<SessionInfo, "state">, live: BridgeSession | undefined) {
	if (live?.session.isStreaming) return "running" as const;
	if (info.state?.status === "crash") return "failed" as const;
	return live ? ("idle" as const) : ("interrupted" as const);
}

async function sessionProjectIds() {
	const bridge = getBridge();
	const sessions = await bridge.listSessions();
	const registry = getPrimeConfig().projectRegistry;
	const assignmentEntries = await Promise.all(
		sessions.map(
			async (session) =>
				[
					session.id,
					await registry.projectIdForSession(session.id, bridge.getSession(session.id)?.cwd ?? session.cwd),
				] as const,
		),
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
			sessions: sessions.map((session) => ({
				sessionId: session.id,
				projectId: assignments.get(session.id) ?? null,
				title: redactSessionLabelSecrets(session.name || session.firstMessage || session.id.slice(0, 8)),
				createdAt: session.created.toISOString(),
				updatedAt: session.modified.toISOString(),
				status: sessionStatus(session, getBridge().getSession(session.id)),
				messageCount: session.messageCount,
				firstMessage: session.firstMessage ? redactSessionLabelSecrets(session.firstMessage) : session.firstMessage,
			})),
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
