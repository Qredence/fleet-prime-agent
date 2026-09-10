import {
	ChatQueueMutationRequestSchema,
	ChatQueueMutationResponseSchema,
} from "@prime-agent/web-protocol/chat-protocol.zod";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";
import { requireProjectSession } from "./session-access";

/**
 * Processes a request to delete a queued chat message.
 *
 * @returns A JSON response containing the validated mutation result
 */
export function handleChatQueueMutationPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ChatQueueMutationRequestSchema.parse(await request.json().catch(() => ({})));
		const bridge = getBridge();
		const session = bridge.getSession(body.sessionId) ?? (await bridge.resumeSessionById(body.sessionId));
		if (!(await requireProjectSession(session))) {
			return Response.json({ message: `Unknown session: ${body.sessionId}` }, { status: 404 });
		}
		const result = await bridge.deleteQueuedMessage(body.sessionId, body.lane, body.index, body.expectedText);
		return Response.json(ChatQueueMutationResponseSchema.parse(result));
	}, request);
}
