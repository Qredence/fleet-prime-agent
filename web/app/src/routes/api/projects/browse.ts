import { handleProjectBrowseGet } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/projects/browse")({
	server: {
		handlers: {
			GET: ({ request }) => handleProjectBrowseGet(request),
		},
	},
});
