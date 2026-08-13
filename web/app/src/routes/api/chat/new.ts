import { handleChatNewPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/new")({
	server: {
		handlers: {
			POST: ({ request }) => handleChatNewPost(request),
		},
	},
});
