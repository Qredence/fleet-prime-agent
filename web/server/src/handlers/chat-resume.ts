import { SessionIdSchema } from "@prime-agent/web-protocol/fleet-contract";
import { z } from "zod";
import { loadManagedPlanPresentations } from "../managed-plan-presentations";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

const BodySchema = z.object({
	sessionId: SessionIdSchema,
});

export function handleChatResumePost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = BodySchema.parse(raw);
		const bridge = getBridge();

		if (body.sessionId) {
			const session = await bridge.resumeSessionById(body.sessionId);
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
			});
		}
		return Response.json({ message: "resume requires sessionId" }, { status: 400 });
	});
}
