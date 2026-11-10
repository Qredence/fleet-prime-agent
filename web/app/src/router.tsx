import "@tanstack/react-start";

import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { initOpenUIObservability } from "@/lib/openui-observability";
import { routeTree } from "./routeTree.gen";

// Route modules are imported above, but no OpenUI response has rendered yet.
initOpenUIObservability();

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,

		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
