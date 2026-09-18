import { ComposerCompletionRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { createComposerCompletionService } from "../completion/service";
import { getPromptIndex } from "../completion/singleton";
import { wrapApiHandler } from "../wrap-api-handler";

/**
 * Offers an inline completion for a composer draft.
 *
 * Answers from an in-memory corpus and never awaits a build or the network, so
 * it is safe to call on a typing pause. An empty body is the ordinary answer and
 * means "show no ghost"; the browser sends the draft to the agent unchanged.
 */
export function handleChatCompletionPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ComposerCompletionRequestSchema.parse(await request.json().catch(() => ({})));
		const service = createComposerCompletionService({ index: getPromptIndex() });
		return Response.json(service.complete(body.text));
	}, request);
}
