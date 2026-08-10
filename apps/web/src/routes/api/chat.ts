import { createFileRoute } from "@tanstack/react-router"
import { ChatRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod"
import { wrapApiHandler } from "@/lib/api-utils"
import { getBridge } from "@/server/singleton"

export const Route = createFileRoute("/api/chat")({
	server: {
		handlers: {
			POST: async ({ request }) =>
				wrapApiHandler(async () => {
				const raw = await request.json()
				const body = ChatRequestSchema.parse(raw)
				const { sessionId, sessionFile, message, model } = body
				if (!message || typeof message !== "string") {
					return Response.json(
						{ message: "POST /api/chat requires a `message` string." },
						{ status: 400 },
					)
				}

				const bridge = getBridge()
				const targetSessionId = sessionId ?? sessionFile
				if (!targetSessionId) {
					return Response.json(
						{ message: "POST /api/chat requires a `sessionId` (or `sessionFile`)." },
						{ status: 400 },
					)
				}
				if (process.env.PRIME_BRIDGE_DEBUG === "1") {
					process.stderr.write(
						`[chat] received session=${targetSessionId.slice(0, 8)} bytes=${message.length}\n`,
					)
				}
				const session =
					bridge.getSession(targetSessionId) ??
					(await bridge.resumeSessionById(targetSessionId))
				if (!session) {
					return Response.json(
						{ message: `Unknown session: ${targetSessionId}` },
						{ status: 404 },
					)
				}
				if (model !== undefined) {
					await bridge.setModel(session.sessionId, model)
				}
					if (process.env.PRIME_BRIDGE_DEBUG === "1") {
						process.stderr.write(
							`[chat] session resolved; prompt len=${session.session.sessionManager.buildSessionContext().messages.length}\n`,
						)
					}

					const encoder = new TextEncoder()

					// Use a ReadableStream with start(controller) — TransformStream's
					// writer.write() back-pressures on the consumer actually pulling
					// from the pipe, which dead-locks under some server adapters
					// because our Response(readable) hand-off is lazy. Starting a
					// ReadableStream directly lets us enqueue frames eagerly and
					// relies on the runtime's internal queueing.
					let removeListener: (() => void) | undefined
					const stream = new ReadableStream<Uint8Array>({
						async start(controller) {
							const write = (frame: unknown) => {
								try {
									controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
								} catch {
									/* stream already cancelled */
								}
							}

							removeListener = bridge.addEventListener((sid, frame) => {
								if (sid !== session.sessionId) return
								write(frame)
								if (frame.type === "done" || frame.type === "error") {
									removeListener?.()
									try {
										controller.close()
									} catch {
										/* already closed */
									}
								}
							})

							write({
								type: "start",
								id: crypto.randomUUID(),
								runId: session.mapperState.runId || "pending",
								sessionId: session.sessionId,
								sessionFile: session.sessionPath,
							})
							if (process.env.PRIME_BRIDGE_DEBUG === "1") {
								process.stderr.write(`[chat] wrote start; firing prompt\n`)
							}

							void bridge
								.prompt(session.sessionId, message, {
									streamingBehavior: body.streamingBehavior,
								})
								.catch((error) => {
									process.stderr.write(
										`[chat] prompt errored: ${error instanceof Error ? error.message : String(error)}\n`,
									)
									write({
										type: "error",
										message: error instanceof Error ? error.message : String(error),
									})
									removeListener?.()
									try {
										controller.close()
									} catch {
										/* already closed */
									}
								})
						},
						cancel() {
							removeListener?.()
						},
					})

					return new Response(stream, {
						headers: {
							"Content-Type": "application/x-ndjson; charset=utf-8",
							"Cache-Control": "no-cache, no-store",
							Connection: "keep-alive",
							"X-Accel-Buffering": "no",
						},
					})
				}),
		},
	},
})
