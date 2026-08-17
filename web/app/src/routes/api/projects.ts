import {
	handleProjectDelete,
	handleProjectPatch,
	handleProjectsGet,
	handleProjectsPost,
} from "@prime-agent/web-server";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/projects")({
	server: {
		handlers: {
			DELETE: ({ request }) => handleProjectDelete(request),
			GET: ({ request }) => handleProjectsGet(request),
			PATCH: ({ request }) => handleProjectPatch(request),
			POST: ({ request }) => handleProjectsPost(request),
		},
	},
});
