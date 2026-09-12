import { handleChatMcpOAuthPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/mcp/oauth")({
	server: {
		handlers: {
			POST: ({ request }) => handleChatMcpOAuthPost(request),
		},
	},
});
