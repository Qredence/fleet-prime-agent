import { handleProjectSessionFork } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/projects/fork")({
	server: {
		handlers: {
			POST: ({ request }) => handleProjectSessionFork(request),
		},
	},
});
