import { createFileRoute } from "@tanstack/react-router"
import { wrapApiHandler } from "@/lib/api-utils"

// v1 stub — workspace tree panel is out of scope (see plan "Out of scope"):
// no file watching, no /api/workspace/file reads. Empty tree shape keeps the
// right panel rendering without errors.
export const Route = createFileRoute("/api/workspace/tree")({
	server: {
		handlers: {
			GET: async () =>
				wrapApiHandler(async () => {
					return Response.json({
						exists: false,
						tree: null,
						runtimeTools: [],
						missingPaths: [],
					})
				}),
		},
	},
})
