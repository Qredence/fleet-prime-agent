import { handleChatCommandsGet } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/commands")({
	server: {
		handlers: {
			GET: ({ request }) => handleChatCommandsGet(request),
		},
	},
});
