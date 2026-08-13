import { handleChatModelsGet } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/models")({
	server: {
		handlers: {
			GET: ({ request }) => handleChatModelsGet(request),
		},
	},
});
