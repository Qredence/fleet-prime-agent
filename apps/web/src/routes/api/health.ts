import { createFileRoute } from "@tanstack/react-router"
import { wrapApiHandler } from "@/lib/api-utils"
import { getBridge } from "@/server/singleton"

export const Route = createFileRoute("/api/health")({
	server: {
		handlers: {
			GET: async () =>
				wrapApiHandler(async () => {
					const bridge = getBridge()
					const kernel = bridge.kernelReadyState()
					return Response.json({
						ok: true,
						kernel,
						uptimeMs: process.uptime() * 1_000,
					})
				}),
		},
	},
})
