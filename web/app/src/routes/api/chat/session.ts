import { handleChatSessionGet } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/session")({
	server: {
		handlers: {
			GET: ({ request }) => handleChatSessionGet(request),
		},
	},
});
