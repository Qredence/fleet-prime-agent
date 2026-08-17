import { handleChatSessionDelete, handleChatSessionRenamePatch, handleChatSessionsGet } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/sessions")({
	server: {
		handlers: {
			DELETE: ({ request }) => handleChatSessionDelete(request),
			GET: ({ request }) => handleChatSessionsGet(request),
			PATCH: ({ request }) => handleChatSessionRenamePatch(request),
		},
	},
});
