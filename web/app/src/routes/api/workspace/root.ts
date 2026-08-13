import { handleWorkspaceRootPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/root")({
	server: {
		handlers: {
			POST: ({ request }) => handleWorkspaceRootPost(request),
		},
	},
});
