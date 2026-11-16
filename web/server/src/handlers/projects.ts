import {
	ProjectCreateRequestSchema,
	ProjectForkRequestSchema,
	ProjectIdSchema,
	ProjectRenameRequestSchema,
} from "@prime-agent/web-protocol";
import { getPrimeConfig } from "../prime-config";
import { listSessionRows } from "../session-list";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";
import { requireSession } from "./session-access";

/**
 * Lists registered projects and their associated session metadata.
 *
 * @returns A response containing project records with session counts and normalized session details.
 */
export function handleProjectsGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const registry = getPrimeConfig().projectRegistry;
		const sessions = await listSessionRows(getBridge(), registry);
		const counts = new Map<string, number>();
		for (const session of sessions) {
			if (session.projectId) counts.set(session.projectId, (counts.get(session.projectId) ?? 0) + 1);
		}
		return Response.json({ projects: await registry.list(counts), sessions });
	}, request);
}

export function handleProjectsPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ProjectCreateRequestSchema.parse(await request.json().catch(() => ({})));
		const registry = getPrimeConfig().projectRegistry;
		const path = await registry.resolveDirectoryInput(body);
		return Response.json({ project: await registry.register(path, body.name) }, { status: 201 });
	}, request);
}

export function handleProjectPatch(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const projectId = ProjectIdSchema.parse(new URL(request.url).searchParams.get("projectId") ?? "");
		const body = ProjectRenameRequestSchema.parse(await request.json().catch(() => ({})));
		return Response.json({ project: await getPrimeConfig().projectRegistry.rename(projectId, body.name) });
	}, request);
}

export function handleProjectDelete(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const projectId = ProjectIdSchema.parse(new URL(request.url).searchParams.get("projectId") ?? "");
		return Response.json({ project: await getPrimeConfig().projectRegistry.unregister(projectId) });
	}, request);
}

export function handleProjectSessionFork(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ProjectForkRequestSchema.parse(await request.json().catch(() => ({})));
		const source = await requireSession(body.sessionId);
		if (!source) return Response.json({ message: `Unknown session: ${body.sessionId}` }, { status: 404 });
		const sessionId = await getBridge().forkSessionIntoProject(body.sessionId, body.targetProjectId);
		return Response.json({ sessionId, projectId: body.targetProjectId }, { status: 201 });
	}, request);
}

export function handleProjectBrowseGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const url = new URL(request.url);
		const result = await getPrimeConfig().projectRegistry.browse({
			path: url.searchParams.get("path") ?? undefined,
			token: url.searchParams.get("token") ?? undefined,
		});
		return Response.json(result);
	}, request);
}
