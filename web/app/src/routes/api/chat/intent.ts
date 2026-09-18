import { handleChatIntentGet, handleChatIntentPatch, handleChatIntentPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/intent")({
	server: {
		handlers: {
			GET: ({ request }) => handleChatIntentGet(request),
			PATCH: ({ request }) => handleChatIntentPatch(request),
			POST: ({ request }) => handleChatIntentPost(request),
		},
	},
});
