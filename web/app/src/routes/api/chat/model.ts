import { handleChatModelPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/model")({
	server: {
		handlers: {
			POST: ({ request }) => handleChatModelPost(request),
		},
	},
});
