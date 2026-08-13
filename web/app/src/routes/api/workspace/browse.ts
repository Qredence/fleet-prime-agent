import { handleWorkspaceBrowseGet } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/browse")({
	server: {
		handlers: {
			GET: ({ request }) => handleWorkspaceBrowseGet(request),
		},
	},
});
