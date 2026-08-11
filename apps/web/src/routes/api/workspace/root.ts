import { createFileRoute } from "@tanstack/react-router"
import { WorkspaceRootRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod"
import { wrapApiHandler } from "@/lib/api-utils"
import { getPrimeConfig } from "@/server/prime-config"
import { resolveWorkspaceRootPath } from "@/server/workspace-root"

// POST /api/workspace/root — rebind prime-agent defaultCwd to the selected
// project folder. Tree / file APIs and new sessions follow this root.
export const Route = createFileRoute("/api/workspace/root")({
	server: {
		handlers: {
			POST: async ({ request }) =>
				wrapApiHandler(async () => {
					const raw = await request.json().catch(() => ({}))
					const body = WorkspaceRootRequestSchema.parse(raw)
					const resolved = await resolveWorkspaceRootPath(body.path)
					if (resolved.kind === "error") {
						return Response.json(
							{ message: resolved.message },
							{ status: resolved.status },
						)
					}
					getPrimeConfig().setDefaultCwd(resolved.root)
					return Response.json({ root: getPrimeConfig().defaultCwd })
				}),
		},
	},
})
