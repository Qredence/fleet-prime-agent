import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/workspace/root")({
	server: {
		handlers: {
			POST: () => Response.json({ message: "The workspace root is fixed when Fleet starts" }, { status: 405 }),
		},
	},
});
