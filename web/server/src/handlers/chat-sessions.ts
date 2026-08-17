import { ProjectIdSchema } from "@prime-agent/web-protocol";
import { getPrimeConfig } from "../prime-config";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";
import { sessionStatus } from "./projects";

export function handleChatSessionsGet(_request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const bridge = getBridge();
		const requestedProjectId = new URL(_request.url).searchParams.get("projectId");
		const projectId = requestedProjectId ? ProjectIdSchema.parse(requestedProjectId) : undefined;
		const sessions = await bridge.listSessions();
		const formatted = await Promise.all(
			sessions.map(async (s) => {
				const liveSession = bridge.getSession(s.id);
				return {
					sessionId: s.id,
					projectId: await getPrimeConfig().projectRegistry.projectIdForSession(s.id, liveSession?.cwd ?? s.cwd),
					title: s.name || s.firstMessage || s.id.slice(0, 8),
					createdAt: s.created.toISOString(),
					updatedAt: s.modified.toISOString(),
					status: sessionStatus(s, liveSession),
					messageCount: s.messageCount,
					firstMessage: s.firstMessage,
				};
			}),
		);
		return Response.json({
			sessions: projectId ? formatted.filter((session) => session.projectId === projectId) : formatted,
		});
	});
}
