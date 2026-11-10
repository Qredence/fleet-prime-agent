import { handleDashboardsTokenPost } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/dashboards/token")({
	server: {
		handlers: {
			POST: ({ request }) => handleDashboardsTokenPost(request),
		},
	},
});
