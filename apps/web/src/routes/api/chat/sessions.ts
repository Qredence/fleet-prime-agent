import { createFileRoute } from "@tanstack/react-router"
import { getBridge } from "@/server/singleton"
import { wrapApiHandler } from "@/lib/api-utils"

export const Route = createFileRoute("/api/chat/sessions")({
	server: {
		handlers: {
			GET: async ({ request }) =>
				wrapApiHandler(async () => {
					const url = new URL(request.url)
					const cwd = url.searchParams.get("cwd") ?? undefined
					const bridge = getBridge()
					const sessions = await bridge.listSessions(cwd)
					const formatted = sessions.map((s) => ({
						path: s.path,
						id: s.id,
						cwd: s.cwd,
						name: s.name,
						created: s.created.toISOString(),
						modified: s.modified.toISOString(),
						messageCount: s.messageCount,
						firstMessage: s.firstMessage,
					}))
					return Response.json({ sessions: formatted })
				}),
		},
	},
})
