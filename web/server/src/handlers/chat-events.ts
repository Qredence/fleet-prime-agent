import { getBridge } from "../singleton";
import { shouldReplaySseEvent } from "../sse-replay";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleChatEventsGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const url = new URL(request.url);
		const sessionId = url.searchParams.get("sessionId");
		if (!sessionId) {
			return Response.json({ message: "SSE requires ?sessionId=" }, { status: 400 });
		}
		const lastEventIdRaw = request.headers.get("last-event-id") ?? url.searchParams.get("lastEventId");
		const parsedLastEventId = lastEventIdRaw ? Number.parseInt(lastEventIdRaw, 10) : 0;
		const lastEventId = Number.isFinite(parsedLastEventId) && parsedLastEventId > 0 ? parsedLastEventId : 0;

		const bridge = getBridge();
		const encoder = new TextEncoder();

		let heartbeat: ReturnType<typeof setInterval> | undefined;
		let removeListener: (() => void) | undefined;

		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				let closed = false;
				const enqueue = (data: string) => {
					if (closed) return;
					try {
						controller.enqueue(encoder.encode(data));
					} catch {
						closed = true;
					}
				};
				const write = (chunk: { id?: number; data: unknown }) => {
					const lines = [
						chunk.id !== undefined ? `id: ${chunk.id}\n` : "",
						`event: message\n`,
						`data: ${JSON.stringify(chunk.data)}\n\n`,
					];
					enqueue(lines.join(""));
				};

				write({ data: { type: "connected", sessionId } });

				let liveCursor = lastEventId;
				let pendingQuestionIds: ReadonlySet<string> | null =
					lastEventId === 0
						? new Set(bridge.pendingDialogsFor(sessionId).map((dialog) => dialog.toolCallId))
						: null;
				const flush = () => {
					const { replayed } = bridge.replaySince(sessionId, liveCursor);
					for (const entry of replayed) {
						liveCursor = entry.seq;
						if (!shouldReplaySseEvent(entry.event, pendingQuestionIds)) {
							continue;
						}
						write({ id: entry.seq, data: entry.event });
					}
					pendingQuestionIds = null;
				};
				removeListener = bridge.addEventListener((sid) => {
					if (sid !== sessionId) return;
					flush();
				});

				if (lastEventId > 0) {
					const { overflowed } = bridge.replaySince(sessionId, lastEventId);
					if (overflowed) {
						write({
							data: {
								type: "state",
								state: {
									name: "agent_settled",
									message: "resync-required",
								},
							},
						});
					}
				}
				flush();

				heartbeat = setInterval(() => {
					enqueue(`: heartbeat\n\n`);
				}, 15_000);

				request.signal.addEventListener("abort", () => {
					if (closed) return;
					closed = true;
					if (heartbeat) clearInterval(heartbeat);
					removeListener?.();
					try {
						controller.close();
					} catch {
						/* already closed */
					}
				});
			},
			cancel() {
				if (heartbeat) clearInterval(heartbeat);
				removeListener?.();
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream; charset=utf-8",
				"Cache-Control": "no-cache, no-store",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			},
		});
	});
}
