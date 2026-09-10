import { SessionIdSchema } from "@prime-agent/web-protocol/fleet-contract";
import { z } from "zod";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";
import { requireProjectSession } from "./session-access";

const BodySchema = z.object({
	sessionId: SessionIdSchema.optional(),
	childId: z.string().min(1).max(160).optional(),
});

export function handleChatAbortPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = BodySchema.parse(raw);
		const sessionId = body.sessionId;
		if (!sessionId) {
			return Response.json({ message: "abort requires sessionId" }, { status: 400 });
		}
		const bridge = getBridge();
		const session = bridge.getSession(sessionId) ?? (await bridge.resumeSessionById(sessionId));
		if (!(await requireProjectSession(session))) {
			return Response.json({ message: `Unknown session: ${sessionId}` }, { status: 404 });
		}
		if (body.childId) {
			const aborted = await bridge.abortRlmChild(sessionId, body.childId);
			if (!aborted) {
				return Response.json({ message: `No active subagent turn: ${body.childId}` }, { status: 404 });
			}
			return Response.json({ ok: true, sessionId, childId: body.childId });
		}
		await bridge.abort(sessionId);
		return Response.json({ ok: true, sessionId });
	}, request);
}
