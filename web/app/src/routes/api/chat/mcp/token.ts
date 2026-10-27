import { handleChatMcpTokenPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/mcp/token")({
	server: {
		handlers: {
			POST: ({ request }) => handleChatMcpTokenPost(request),
		},
	},
});
