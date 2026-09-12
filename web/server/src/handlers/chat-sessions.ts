import { ProjectIdSchema } from "@prime-agent/web-protocol";
import { getPrimeConfig } from "../prime-config";
import { applyPresentationToSessionRow, loadSessionListPresentation, normalizeSessionListRow } from "../session-list";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";
import { sessionStatus } from "./projects";

/**
 * Retrieves chat sessions with normalized metadata and optional project filtering.
 *
 * @returns A JSON response containing the matching chat sessions.
 */
export function handleChatSessionsGet(_request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const bridge = getBridge();
		const requestedProjectId = new URL(_request.url).searchParams.get("projectId");
		const projectId = requestedProjectId ? ProjectIdSchema.parse(requestedProjectId) : undefined;
		const sessions = await bridge.listSessions();
		const formatted = await Promise.all(
			sessions.map(async (s) => {
				const session = normalizeSessionListRow(s);
				const liveSession = bridge.getSession(session.sessionId);
				const fields = applyPresentationToSessionRow(
					session,
					await loadSessionListPresentation(session, s, liveSession?.mapperState?.presentation),
				);
				return {
					sessionId: session.sessionId,
					projectId: await getPrimeConfig().projectRegistry.projectIdForSession(
						session.sessionId,
						liveSession?.cwd ?? session.cwd,
					),
					title: fields.title,
					createdAt: session.createdAt,
					updatedAt: session.updatedAt,
					status: sessionStatus(session.source, liveSession),
					messageCount: fields.messageCount,
					firstMessage: fields.firstMessage,
					...(session.isSubagent ? { isSubagent: true } : {}),
				};
			}),
		);
		return Response.json({
			sessions: projectId ? formatted.filter((session) => session.projectId === projectId) : formatted,
		});
	}, _request);
}
