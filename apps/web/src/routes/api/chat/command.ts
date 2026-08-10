import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { getBridge } from "@/server/singleton"
import { wrapApiHandler } from "@/lib/api-utils"

const BodySchema = z.object({
	sessionId: z.string(),
	command: z.string(),
	args: z.string().optional(),
})

/**
 * POST /api/chat/command — server-side runner for TUI builtins that need to
 * touch prime-agent state but aren't streamed through the LLM. The composer's
 * dispatcher routes anything not pure-UI here.
 *
 * Scope: the command surface mirrors the web port of
 * `packages/coding-agent/src/modes/interactive/interactive-mode.ts`'s builtin
 * handler chain. Add a case when you add a command.
 */
export const Route = createFileRoute("/api/chat/command")({
	server: {
		handlers: {
			POST: async ({ request }) =>
				wrapApiHandler(async () => {
					const body = BodySchema.parse(await request.json().catch(() => ({})))
					const bridge = getBridge()
					const args = body.args?.trim() ?? ""

					switch (body.command) {
						case "session":
							return Response.json({
								ok: true,
								name: bridge.getSessionName(body.sessionId) ?? null,
							})
						case "name": {
							if (!args) {
								return Response.json(
									{ message: "/name requires a display name." },
									{ status: 400 },
								)
							}
							bridge.setSessionName(body.sessionId, args)
							return Response.json({ ok: true, name: args })
						}
						case "context": {
							const usage = bridge.getContextUsage(body.sessionId)
							if (!usage) {
								return Response.json({ ok: true, usage: null })
							}
							return Response.json({ ok: true, usage })
						}
						case "system-prompt":
							return Response.json({
								ok: true,
								systemPrompt: bridge.getSystemPrompt(body.sessionId),
							})
						case "export": {
							const outputPath = args || undefined
							const result = await bridge.exportSession(body.sessionId, outputPath)
							return Response.json({ ok: true, ...result })
						}
						case "reload":
							await bridge.reloadResources(body.sessionId)
							return Response.json({ ok: true })
						case "tree": {
							if (!args) {
								return Response.json(
									{ message: "/tree requires a target entry id in the web port." },
									{ status: 400 },
								)
							}
							await bridge.navigateTree(body.sessionId, args)
							return Response.json({ ok: true })
						}
						case "fork":
						case "clone":
							return Response.json(
								{
									message:
										`/${body.command} requires prime-agent's daemon runtime (runtimeHost.fork), ` +
										"which the web bridge doesn't expose yet. Tracked as a v2 surface.",
								},
								{ status: 501 },
							)
						default:
							return Response.json(
								{ message: `Unknown slash command: /${body.command}` },
								{ status: 404 },
							)
					}
				}),
		},
	},
})
