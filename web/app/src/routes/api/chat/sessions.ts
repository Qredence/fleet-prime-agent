import { handleChatSessionsGet } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/sessions")({
	server: {
		handlers: {
			GET: ({ request }) => handleChatSessionsGet(request),
		},
	},
});
