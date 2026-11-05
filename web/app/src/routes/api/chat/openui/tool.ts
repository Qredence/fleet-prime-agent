import { handleOpenUIToolPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/openui/tool")({
	server: {
		handlers: {
			POST: ({ request }) => handleOpenUIToolPost(request),
		},
	},
});
