import { z } from "zod";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

const BodySchema = z.object({
	sessionId: z.string(),
	model: z.object({
		provider: z.string(),
		id: z.string(),
	}),
});

export function handleChatModelPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = BodySchema.parse(raw);
		const bridge = getBridge();
		await bridge.setModel(body.sessionId, {
			provider: body.model.provider,
			id: body.model.id,
		});
		return Response.json({ ok: true });
	});
}
