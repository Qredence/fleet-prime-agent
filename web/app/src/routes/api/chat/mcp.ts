import { handleChatMcpDelete, handleChatMcpGet, handleChatMcpPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/mcp")({
	server: {
		handlers: {
			GET: ({ request }) => handleChatMcpGet(request),
			POST: ({ request }) => handleChatMcpPost(request),
			DELETE: ({ request }) => handleChatMcpDelete(request),
		},
	},
});
