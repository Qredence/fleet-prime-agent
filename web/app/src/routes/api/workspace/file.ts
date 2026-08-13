import { handleWorkspaceFileGet } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/file")({
	server: {
		handlers: {
			GET: ({ request }) => handleWorkspaceFileGet(request),
		},
	},
});
