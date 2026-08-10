import { createFileRoute } from "@tanstack/react-router"
import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import { z } from "zod"
import { getBridge } from "@/server/singleton"
import { wrapApiHandler } from "@/lib/api-utils"

// Keep off|minimal|low|medium|high|xhigh|max in sync with pi-ai's
// ModelThinkingLevel. The bridge store narrows to ThinkingLevel internally by
// treating "off" as "no thinking budget".
const BodySchema = z.object({
  // Optional: when omitted we run the session in the server's own cwd. The
  // new-session dialog (v2) will surface this as an explicit field.
  cwd: z.string().min(1).optional(),
  model: z.unknown().optional(),
  thinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
})

export const Route = createFileRoute("/api/chat/new")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        wrapApiHandler(async () => {
          const bridge = getBridge()
          // Kick the kernel in the background — don't block session creation
          // on it. IPython tool awaits readiness before its first call, so a
          // slow kernel boot doesn't gate the user's first prompt.
          void bridge.ensureKernelReady().catch(() => {
            /* backgrounded; failures surface when ipython is invoked */
          })

          const raw = await request.json().catch(() => ({}))
          const body = BodySchema.parse(raw)
          const level: ThinkingLevel | undefined = body.thinkingLevel
          const session = await bridge.createSession({
            cwd: body.cwd ?? process.cwd(),
            model: body.model,
            thinkingLevel: level,
          })
          return Response.json({
            session: {
              sessionId: session.sessionId,
              sessionFile: session.sessionPath,
              cwd: session.cwd,
            },
            messages: [],
          })
        }),
    },
  },
})
