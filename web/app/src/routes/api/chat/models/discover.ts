import { handleChatModelsDiscoverPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/models/discover")({
	server: {
		handlers: {
			POST: ({ request }) => handleChatModelsDiscoverPost(request),
		},
	},
});
