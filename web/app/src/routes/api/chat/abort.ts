import { handleChatAbortPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/abort")({
	server: {
		handlers: {
			POST: ({ request }) => handleChatAbortPost(request),
		},
	},
});
