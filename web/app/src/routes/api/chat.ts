import { handleChatPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat")({
	server: {
		handlers: {
			POST: ({ request }) => handleChatPost(request),
		},
	},
});
