import { handleChatCompletionPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/completion")({
	server: {
		handlers: {
			POST: ({ request }) => handleChatCompletionPost(request),
		},
	},
});
