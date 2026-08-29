import { handleChatOpenUIArtifactPut } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/artifacts")({
	server: {
		handlers: {
			PUT: ({ request }) => handleChatOpenUIArtifactPut(request),
		},
	},
});
