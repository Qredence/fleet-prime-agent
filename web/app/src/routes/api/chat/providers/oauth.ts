import { handleChatProvidersOAuthPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/providers/oauth")({
	server: {
		handlers: {
			POST: ({ request }) => handleChatProvidersOAuthPost(request),
		},
	},
});
