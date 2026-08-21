import { ChatPlanPresentationUpsertRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { loadManagedPlanPresentations, upsertManagedPlanPresentation } from "../managed-plan-presentations";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleChatPlanPresentationPut(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ChatPlanPresentationUpsertRequestSchema.parse(await request.json().catch(() => ({})));
		const bridge = getBridge();
		const session = bridge.getSession(body.sessionId) ?? (await bridge.resumeSessionById(body.sessionId));
		if (!session) return Response.json({ message: `Unknown session: ${body.sessionId}` }, { status: 404 });
		const messages = await bridge.getMessages(body.sessionId);
		const known = messages.find(
			(message) => message.id === body.presentation.assistantMessageId && message.role === "assistant",
		);
		const existing = (await loadManagedPlanPresentations(session)).find(
			(item) => item.assistantMessageId === body.presentation.assistantMessageId,
		);
		const fallback = [...messages].reverse().find((message) => message.role === "assistant");
		const assistantMessageId = known?.id ?? existing?.assistantMessageId ?? fallback?.id;
		if (!assistantMessageId)
			return Response.json(
				{ message: "Unable to associate Plan presentation with an assistant message" },
				{ status: 409 },
			);
		return Response.json({
			presentation: await upsertManagedPlanPresentation(session, { ...body.presentation, assistantMessageId }),
		});
	});
}
