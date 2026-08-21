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

		const incomingId = body.presentation.assistantMessageId;
		const known = messages.find((message) => message.id === incomingId && message.role === "assistant");
		const stored = await loadManagedPlanPresentations(session);
		// Streamed message ids are run-scoped (`run-…-aN`) and never match the
		// hydrated `${sessionId}-mN` ids, so stored records must additionally match
		// on the client id they were first written with.
		const existing = stored.find(
			(item) => item.assistantMessageId === incomingId || item.clientMessageId === incomingId,
		);
		// Fallback association is only safe on the FIRST write: the completed
		// plan-mode turn just ended, so its message is the last hydrated one.
		const fallback = existing ? undefined : [...messages].reverse().find((message) => message.role === "assistant");
		const assistantMessageId = known?.id ?? existing?.assistantMessageId ?? fallback?.id;
		if (!assistantMessageId) {
			return Response.json(
				{ message: "Unable to associate Plan presentation with an assistant message" },
				{ status: 409 },
			);
		}
		const clientMessageId =
			incomingId !== assistantMessageId ? (existing?.clientMessageId ?? incomingId) : existing?.clientMessageId;
		return Response.json({
			presentation: await upsertManagedPlanPresentation(session, {
				...body.presentation,
				assistantMessageId,
				...(clientMessageId ? { clientMessageId } : {}),
			}),
		});
	});
}
