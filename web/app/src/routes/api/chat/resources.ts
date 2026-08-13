import { handleChatResourcesGet } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/resources")({
	server: {
		handlers: {
			GET: ({ request }) => handleChatResourcesGet(request),
		},
	},
});
