import { SessionIdSchema } from "@prime-agent/web-protocol/fleet-contract";
import { z } from "zod/v4";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

const RenameSessionSchema = z.object({
	sessionId: SessionIdSchema,
	title: z.string().trim().min(1).max(200),
});

const DeleteSessionSchema = z.object({ sessionId: SessionIdSchema });

export function handleChatSessionRenamePatch(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = RenameSessionSchema.parse(await request.json().catch(() => ({})));
		const bridge = getBridge();
		const session = bridge.getSession(body.sessionId) ?? (await bridge.resumeSessionById(body.sessionId));
		if (!session) {
			return Response.json({ message: `Unknown session: ${body.sessionId}` }, { status: 404 });
		}
		bridge.setSessionName(body.sessionId, body.title);
		return Response.json({ ok: true, sessionId: body.sessionId, title: body.title });
	});
}

export function handleChatSessionDelete(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = DeleteSessionSchema.parse(await request.json().catch(() => ({})));
		const deleted = await getBridge().deleteSession(body.sessionId);
		if (!deleted) {
			return Response.json({ message: `Unknown session: ${body.sessionId}` }, { status: 404 });
		}
		return Response.json({ ok: true, sessionId: body.sessionId });
	});
}
