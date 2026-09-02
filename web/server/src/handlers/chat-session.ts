import { ProjectIdSchema, SessionIdSchema } from "@prime-agent/web-protocol";
import { loadManagedPlanPresentations } from "../managed-plan-presentations";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleChatSessionGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const url = new URL(request.url);
		const parentSessionId = url.searchParams.get("parentSessionId");
		const childId = url.searchParams.get("childId");
		if (parentSessionId || childId) {
			if (!parentSessionId || !childId) {
				return Response.json(
					{ message: "GET /api/chat/session requires both ?parentSessionId= and ?childId=" },
					{ status: 400 },
				);
			}
			const parsedParentSessionId = SessionIdSchema.safeParse(parentSessionId);
			const parsedChildId = SessionIdSchema.safeParse(childId);
			if (!parsedParentSessionId.success || !parsedChildId.success) {
				return Response.json({ message: "Invalid subagent session identifiers" }, { status: 400 });
			}
			const child = await getBridge().loadRlmChildTranscript(parsedParentSessionId.data, parsedChildId.data);
			if (!child) return Response.json({ message: "Unknown subagent transcript" }, { status: 404 });
			return Response.json({
				session: {
					sessionId: child.sessionId,
					projectId: child.projectId,
				},
				messages: child.messages,
				planPresentations: [],
				presentation: child.presentation,
			});
		}

		const sessionId = url.searchParams.get("sessionId");
		const requestedProjectId = url.searchParams.get("projectId");
		const openUI = url.searchParams.get("openUI") === "true";
		if (!sessionId) {
			return Response.json({ message: "GET /api/chat/session requires ?sessionId=" }, { status: 400 });
		}
		const bridge = getBridge();
		const projectId = requestedProjectId ? ProjectIdSchema.parse(requestedProjectId) : undefined;
		const existing = projectId
			? await bridge.resumeSessionById(sessionId, projectId, { openUI })
			: (bridge.getSession(sessionId) ?? (await bridge.resumeSessionById(sessionId, undefined, { openUI })));
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
