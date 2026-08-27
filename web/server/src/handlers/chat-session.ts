import { ProjectIdSchema } from "@prime-agent/web-protocol";
import { loadManagedPlanPresentations } from "../managed-plan-presentations";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleChatSessionGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const url = new URL(request.url);
		const sessionId = url.searchParams.get("sessionId");
		const requestedProjectId = url.searchParams.get("projectId");
		if (!sessionId) {
			return Response.json({ message: "GET /api/chat/session requires ?sessionId=" }, { status: 400 });
		}
		const bridge = getBridge();
		const projectId = requestedProjectId ? ProjectIdSchema.parse(requestedProjectId) : undefined;
		const existing = projectId
			? await bridge.resumeSessionById(sessionId, projectId)
			: (bridge.getSession(sessionId) ?? (await bridge.resumeSessionById(sessionId)));
		if (!existing) {
			return Response.json({ message: `Unknown session: ${sessionId}` }, { status: 404 });
		}
		return Response.json({
			session: {
				sessionId: existing.sessionId,
				projectId: existing.projectId,
			},
			messages: await bridge.getMessages(existing.sessionId),
			planPresentations: await loadManagedPlanPresentations(existing),
			presentation: bridge.getPresentation(existing.sessionId),
		});
	});
}
