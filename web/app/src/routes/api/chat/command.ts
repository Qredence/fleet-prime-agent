import { handleChatCommandPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/command")({
	server: {
		handlers: {
			POST: ({ request }) => handleChatCommandPost(request),
		},
	},
});
