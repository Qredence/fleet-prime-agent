import { createFileRoute } from "@tanstack/react-router"
import { wrapApiHandler } from "@/lib/api-utils"
import { getPrimeConfig } from "@/server/prime-config"
import { browseWorkspaceDirectories } from "@/server/workspace-browse"

// GET /api/workspace/browse?path=<absolute> — list child directories for the
// "Open project folder" picker. Omitting path uses the current defaultCwd.
export const Route = createFileRoute("/api/workspace/browse")({
	server: {
		handlers: {
			GET: async ({ request }) =>
				wrapApiHandler(async () => {
					const url = new URL(request.url)
					const pathParam = url.searchParams.get("path")
					const path =
						pathParam && pathParam.trim().length > 0
							? pathParam
							: getPrimeConfig().defaultCwd
					const result = await browseWorkspaceDirectories(path)
					if (result.kind === "error") {
						return Response.json(
							{ message: result.message },
							{ status: result.status },
						)
					}
					return Response.json({
						path: result.path,
						parent: result.parent,
						entries: result.entries,
					})
				}),
		},
	},
})
