import { createFileRoute } from "@tanstack/react-router"
import { getBridge } from "@/server/singleton"
import { wrapApiHandler } from "@/lib/api-utils"

export const Route = createFileRoute("/api/chat/session")({
	server: {
		handlers: {
			GET: async ({ request }) =>
				wrapApiHandler(async () => {
					const url = new URL(request.url)
					const sessionId =
						url.searchParams.get("sessionId") ??
						url.searchParams.get("sessionFile")
					if (!sessionId) {
						return Response.json(
							{ message: "GET /api/chat/session requires ?sessionId=" },
							{ status: 400 },
						)
					}
					const bridge = getBridge()
					const existing =
						bridge.getSession(sessionId) ??
						(await bridge.resumeSessionById(sessionId))
					if (!existing) {
						return Response.json(
							{ message: `Unknown session: ${sessionId}` },
							{ status: 404 },
						)
					}
					return Response.json({
						session: {
							sessionId: existing.sessionId,
							sessionFile: existing.sessionPath,
							cwd: existing.cwd,
						},
						messages: await bridge.getMessages(existing.sessionId),
					})
				}),
		},
	},
})
