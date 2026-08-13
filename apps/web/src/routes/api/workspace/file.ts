import { createFileRoute } from "@tanstack/react-router"
import { wrapApiHandler } from "@/lib/api-utils"
import { getPrimeConfig } from "@/server/prime-config"
import { readWorkspaceFile } from "@/server/workspace-file"

// GET /api/workspace/file?path=<relative> — read a text file under defaultCwd
// for the workspace panel preview. Soft failures (too-large / unsupported) are
// HTTP 200 with WorkspaceFileResponse.status; escapes and missing files are
// hard 4xx.
export const Route = createFileRoute("/api/workspace/file")({
	server: {
		handlers: {
			GET: async ({ request }) =>
				wrapApiHandler(async () => {
					const url = new URL(request.url)
					const path = url.searchParams.get("path") ?? ""
					const result = await readWorkspaceFile(
						getPrimeConfig().defaultCwd,
						path,
					)
					if (result.kind === "error") {
						return Response.json(
							{ message: result.message },
							{ status: result.status },
						)
					}
					return Response.json(result.body)
				}),
		},
	},
})
