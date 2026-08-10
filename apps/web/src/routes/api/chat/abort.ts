import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { getBridge } from "@/server/singleton"
import { wrapApiHandler } from "@/lib/api-utils"

const BodySchema = z.object({
  sessionId: z.string().optional(),
  sessionFile: z.string().optional(),
})

export const Route = createFileRoute("/api/chat/abort")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        wrapApiHandler(async () => {
          const raw = await request.json().catch(() => ({}))
          const body = BodySchema.parse(raw)
          const sessionId = body.sessionId ?? body.sessionFile
          if (!sessionId) {
            return Response.json({ message: "abort requires sessionId" }, { status: 400 })
          }
          const bridge = getBridge()
          await bridge.abort(sessionId)
          return Response.json({ ok: true, sessionId })
        }),
    },
  },
})
