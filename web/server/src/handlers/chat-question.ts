import { ChatQuestionAnswerRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleChatQuestionPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json();
		const body = ChatQuestionAnswerRequestSchema.parse(raw);
		const sessionId = body.sessionId;
		const toolCallId = body.toolCallId;
		if (!sessionId || !toolCallId) {
			return Response.json({ ok: false, message: "answer requires sessionId and toolCallId" }, { status: 400 });
		}
		const bridge = getBridge();
		const answered = bridge.answerDialog(sessionId, toolCallId, body.answer);
		if (!answered) {
			return Response.json({ ok: false, message: "Question is no longer active" }, { status: 404 });
		}
		return Response.json({ ok: true });
	});
}
