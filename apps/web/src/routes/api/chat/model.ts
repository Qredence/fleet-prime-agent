import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { getBridge } from "@/server/singleton"
import { wrapApiHandler } from "@/lib/api-utils"

const BodySchema = z.object({
  sessionId: z.string(),
  model: z.object({
    provider: z.string(),
    id: z.string(),
  }),
})

export const Route = createFileRoute("/api/chat/model")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        wrapApiHandler(async () => {
          const raw = await request.json().catch(() => ({}))
          const body = BodySchema.parse(raw)
          const bridge = getBridge()
          await bridge.setModel(body.sessionId, {
            provider: body.model.provider,
            id: body.model.id,
          })
          return Response.json({ ok: true })
        }),
    },
  },
})
