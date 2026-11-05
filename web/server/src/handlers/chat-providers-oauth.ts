import type { ChatProviderOAuthLoginResponse } from "@prime-agent/web-protocol/chat-protocol";
import { ChatProviderOAuthLoginRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleChatProvidersOAuthPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		ChatProviderOAuthLoginRequestSchema.parse(await request.json().catch(() => ({})));
		return Response.json(
			{
				status: "error",
				// Fleet reads provider credentials fresh from `auth.json` on every
				// request (`agent-auth-store`), so there is nothing for a restart to
				// reload here.
				error: "Sign-in has to run inside Prime Agent. In a terminal, start Prime Agent against the same account as Fleet, then run /login and choose the provider. Fleet reads the stored credential on every request. If Fleet uses a non-default account directory, start Prime Agent with the same PRIME_AGENT_CODING_AGENT_DIR it uses.",
			} satisfies ChatProviderOAuthLoginResponse,
			{ status: 501 },
		);
	}, request);
}
