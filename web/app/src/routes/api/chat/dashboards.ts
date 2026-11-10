import { handleDashboardsGet, handleDashboardsPut } from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/dashboards")({
	server: {
		handlers: {
			GET: ({ request }) => handleDashboardsGet(request),
			PUT: ({ request }) => handleDashboardsPut(request),
		},
	},
});
