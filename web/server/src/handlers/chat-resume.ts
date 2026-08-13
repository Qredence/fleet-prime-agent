import { z } from "zod";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

const BodySchema = z.object({
	sessionId: z.string().optional(),
	sessionFile: z.string().optional(),
});

export function handleChatResumePost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = BodySchema.parse(raw);
		const bridge = getBridge();

		if (body.sessionFile) {
			const session = await bridge.resumeSessionByPath(body.sessionFile);
			return Response.json({
				session: {
					sessionId: session.sessionId,
					sessionFile: session.sessionPath,
					cwd: session.cwd,
				},
				messages: await bridge.getMessages(session.sessionId),
			});
		}
		if (body.sessionId) {
			const session = await bridge.resumeSessionById(body.sessionId);
			if (!session) {
				return Response.json({ message: `Unknown session: ${body.sessionId}` }, { status: 404 });
			}
			return Response.json({
				session: {
					sessionId: session.sessionId,
					sessionFile: session.sessionPath,
					cwd: session.cwd,
				},
				messages: await bridge.getMessages(session.sessionId),
			});
		}
		return Response.json({ message: "resume requires sessionId or sessionFile" }, { status: 400 });
	});
}
