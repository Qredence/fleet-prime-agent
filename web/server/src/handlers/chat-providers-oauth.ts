import type { ChatProviderOAuthLoginResponse } from "@prime-agent/web-protocol/chat-protocol";
import { ChatProviderOAuthLoginRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleChatProvidersOAuthPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		ChatProviderOAuthLoginRequestSchema.parse(await request.json().catch(() => ({})));
		return Response.json(
			{
				status: "error",
				error: "Provider OAuth sign-in is unavailable in Fleet settings. Launch Prime Agent in a terminal using the same configuration directory as Fleet and complete provider sign-in there. Restart Fleet afterward to reload the credentials.",
			} satisfies ChatProviderOAuthLoginResponse,
			{ status: 501 },
		);
	}, request);
}
