import { SessionIdSchema } from "@prime-agent/web-protocol/fleet-contract";
import { z } from "zod";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

const BodySchema = z.object({
	sessionId: SessionIdSchema.optional(),
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
		await bridge.abort(sessionId);
		return Response.json({ ok: true, sessionId });
	});
}
