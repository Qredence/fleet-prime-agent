import { z } from "zod";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

const BodySchema = z.object({
	sessionId: z.string().optional(),
	sessionFile: z.string().optional(),
});

export function handleChatAbortPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = BodySchema.parse(raw);
		const sessionId = body.sessionId ?? body.sessionFile;
		if (!sessionId) {
			return Response.json({ message: "abort requires sessionId" }, { status: 400 });
		}
		const bridge = getBridge();
		await bridge.abort(sessionId);
		return Response.json({ ok: true, sessionId });
	});
}
