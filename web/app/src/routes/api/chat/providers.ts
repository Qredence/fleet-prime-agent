import { handleChatProvidersDelete, handleChatProvidersGet, handleChatProvidersPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/providers")({
	server: {
		handlers: {
			GET: ({ request }) => handleChatProvidersGet(request),
			POST: ({ request }) => handleChatProvidersPost(request),
			DELETE: ({ request }) => handleChatProvidersDelete(request),
		},
	},
});
