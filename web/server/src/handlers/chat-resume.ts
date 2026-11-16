import { ChatSessionMetadataSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { SessionIdSchema } from "@prime-agent/web-protocol/fleet-contract";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";
import { buildSessionResponse } from "./chat-session";
import { requireSession } from "./session-access";

const BodySchema = ChatSessionMetadataSchema.extend({ sessionId: SessionIdSchema });

export function handleChatResumePost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = BodySchema.parse(raw);
		const bridge = getBridge();

		const session = await requireSession(body.sessionId, { projectId: body.projectId, openUI: body.openUI });
		if (!session) {
			return Response.json({ message: `Unknown session: ${body.sessionId}` }, { status: 404 });
		}
		return buildSessionResponse(session, bridge);
	}, request);
}
