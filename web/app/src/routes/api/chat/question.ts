import { handleChatQuestionPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/question")({
	server: {
		handlers: {
			POST: ({ request }) => handleChatQuestionPost(request),
		},
	},
});
