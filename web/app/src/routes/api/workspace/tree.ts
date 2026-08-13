import { handleWorkspaceTreeGet } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/tree")({
	server: {
		handlers: {
			GET: ({ request }) => handleWorkspaceTreeGet(request),
		},
	},
});
