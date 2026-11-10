import { handleDashboardsInterpreterPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/dashboards/interpreter")({
	server: {
		handlers: {
			POST: ({ request }) => handleDashboardsInterpreterPost(request),
		},
	},
});
