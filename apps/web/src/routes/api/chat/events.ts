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
					const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
					const writer = writable.getWriter()

					const write = (chunk: { id?: number; data: unknown }) => {
						const lines = [
							chunk.id !== undefined ? `id: ${chunk.id}\n` : "",
							`event: message\n`,
							`data: ${JSON.stringify(chunk.data)}\n\n`,
						]
						return writer.write(encoder.encode(lines.join("")))
					}

					// Initial connection status.
					await write({ data: { type: "connected", sessionId } })

					// Replay buffered frames if the client passed Last-Event-ID.
					// Track the highest seq we emitted so the live tail continues
					// without duplicating frames.
					let liveCursor = lastEventId
					if (lastEventId > 0) {
						const { replayed, overflowed } = bridge.replaySince(sessionId, lastEventId)
						if (overflowed) {
							// Force the client to refetch its session state. The UIs handle
							// this by running to /api/chat/session.
							await write({
								data: {
									type: "state",
									state: { name: "agent_settled", message: "resync-required" },
								},
							})
						}
						for (const entry of replayed) {
							liveCursor = entry.seq
							await write({ id: entry.seq, data: entry.event })
						}
					}

					// Live tail. The bridge pushes to the *buffer* before invoking
					// subscribers, so whenever a new frame arrives for this session we
					// can pull any tail frames we haven't yet written and flush them.
					const removeListener = bridge.addEventListener((sid) => {
						if (sid !== sessionId) return
						const { replayed } = bridge.replaySince(sid, liveCursor)
						for (const e of replayed) {
							liveCursor = e.seq
							void write({ id: e.seq, data: e.event })
						}
					})

					// Keep-alive heartbeat every 15s so proxies don't kill the stream.
					const heartbeat = setInterval(() => {
						void writer.write(encoder.encode(`: heartbeat\n\n`))
					}, 15_000)

					// Tear down when the client disconnects.
					request.signal.addEventListener("abort", () => {
						clearInterval(heartbeat)
						removeListener()
						void writer.close()
					})

					return new Response(readable, {
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
