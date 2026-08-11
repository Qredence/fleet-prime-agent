import { createFileRoute } from "@tanstack/react-router"
import { getBridge } from "@/server/singleton"
import { wrapApiHandler } from "@/lib/api-utils"

export const Route = createFileRoute("/api/chat/events")({
	server: {
		handlers: {
			GET: async ({ request }) =>
				wrapApiHandler(async () => {
					const url = new URL(request.url)
					const sessionId = url.searchParams.get("sessionId")
					if (!sessionId) {
						return Response.json(
							{ message: "SSE requires ?sessionId=" },
							{ status: 400 },
						)
					}
					const lastEventIdHeader = request.headers.get("last-event-id")
					const lastEventId = lastEventIdHeader
						? Number.parseInt(lastEventIdHeader, 10)
						: 0

					const bridge = getBridge()
					const encoder = new TextEncoder()

					// Controller-based ReadableStream (no TransformStream writer). On
					// client disconnect the runtime invokes cancel() and we stop
					// enqueueing — write-side errors can't reject the HTTP response
					// with an unhandled ECONNRESET. Guard each enqueue anyway since a
					// stream can be closed between a listener firing and the call.
					let heartbeat: ReturnType<typeof setInterval> | undefined
					let removeListener: (() => void) | undefined

					const stream = new ReadableStream<Uint8Array>({
						async start(controller) {
							let closed = false
							const enqueue = (data: string) => {
								if (closed) return
								try {
									controller.enqueue(encoder.encode(data))
								} catch {
									closed = true
								}
							}
							const write = (chunk: { id?: number; data: unknown }) => {
								const lines = [
									chunk.id !== undefined ? `id: ${chunk.id}\n` : "",
									`event: message\n`,
									`data: ${JSON.stringify(chunk.data)}\n\n`,
								]
								enqueue(lines.join(""))
							}

							// Initial connection status.
							write({ data: { type: "connected", sessionId } })

							// Replay buffered frames if the client passed Last-Event-ID.
							// Track the highest seq we emitted so the live tail continues
							// without duplicating frames.
							let liveCursor = lastEventId
							if (lastEventId > 0) {
								const { replayed, overflowed } = bridge.replaySince(
									sessionId,
									lastEventId,
								)
								if (overflowed) {
									// Force the client to refetch its session state. The UI handles
									// this by going to /api/chat/session.
									write({
										data: {
											type: "state",
											state: {
												name: "agent_settled",
												message: "resync-required",
											},
										},
									})
								}
								for (const entry of replayed) {
									liveCursor = entry.seq
									write({ id: entry.seq, data: entry.event })
								}
							}

							// Live tail. The bridge pushes to the *buffer* before invoking
							// subscribers, so when a new frame arrives for this session we
							// pull any tail frames we haven't yet written and flush them.
							removeListener = bridge.addEventListener((sid) => {
								if (sid !== sessionId) return
								const { replayed } = bridge.replaySince(sid, liveCursor)
								for (const e of replayed) {
									liveCursor = e.seq
									write({ id: e.seq, data: e.event })
								}
							})

							// Keep-alive heartbeat every 15s so proxies don't kill the stream.
							heartbeat = setInterval(() => {
								enqueue(`: heartbeat\n\n`)
							}, 15_000)

							// Tear down when the client disconnects.
							request.signal.addEventListener("abort", () => {
								if (closed) return
								closed = true
								if (heartbeat) clearInterval(heartbeat)
								removeListener?.()
								try {
									controller.close()
								} catch {
									/* already closed */
								}
							})
						},
						cancel() {
							if (heartbeat) clearInterval(heartbeat)
							removeListener?.()
						},
					})

					return new Response(stream, {
						headers: {
							"Content-Type": "text/event-stream; charset=utf-8",
							"Cache-Control": "no-cache, no-store",
							Connection: "keep-alive",
							"X-Accel-Buffering": "no",
						},
					})
				}),
		},
	},
})
