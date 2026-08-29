import { ChatSessionMetadataSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { SessionIdSchema } from "@prime-agent/web-protocol/fleet-contract";
import { loadManagedPlanPresentations } from "../managed-plan-presentations";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

const BodySchema = ChatSessionMetadataSchema.extend({ sessionId: SessionIdSchema });

export function handleChatResumePost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = BodySchema.parse(raw);
		const bridge = getBridge();

		if (body.sessionId) {
			const session = await bridge.resumeSessionById(body.sessionId, body.projectId, { openUI: body.openUI });
			if (!session) {
				return Response.json({ message: `Unknown session: ${body.sessionId}` }, { status: 404 });
			}
			return Response.json({
				session: {
					sessionId: session.sessionId,
					projectId: session.projectId,
				},
				messages: await bridge.getMessages(session.sessionId),
				planPresentations: await loadManagedPlanPresentations(session),
				presentation: bridge.getPresentation(session.sessionId),
			});
		}
		return Response.json({ message: "resume requires sessionId" }, { status: 400 });
	});
}
