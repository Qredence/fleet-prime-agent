import { handleChatSessionTreeGet, handleChatSessionTreeNavigatePost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/session-tree")({
	server: {
		handlers: {
			GET: ({ request }) => handleChatSessionTreeGet(request),
			POST: ({ request }) => handleChatSessionTreeNavigatePost(request),
		},
	},
});
