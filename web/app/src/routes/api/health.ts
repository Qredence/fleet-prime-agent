import { handleHealthGet } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: ({ request }) => handleHealthGet(request),
		},
	},
});
