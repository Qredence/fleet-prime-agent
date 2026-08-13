import { handleChatEventsGet } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/events")({
	server: {
		handlers: {
			GET: ({ request }) => handleChatEventsGet(request),
		},
	},
});
