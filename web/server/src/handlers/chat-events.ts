import { SessionIdSchema } from "@prime-agent/web-protocol";
import { type ChatStreamEvent, FLEET_ADAPTER_CAPABILITIES } from "@prime-agent/web-protocol/chat-protocol";
import type { PrimeBridge, RlmChildStream } from "../prime-bridge";
import { getBridge } from "../singleton";
import { normalizeSseReplayEvent, shouldReplaySseEvent } from "../sse-replay";
import { wrapApiHandler } from "../wrap-api-handler";

type SseSource = {
	sessionId: string;
	channelId?: string;
	streamGeneration?: string;
	cursorReset?: boolean;
	resumeAccepted?: boolean;
	replayFrom?: number;
	includeSnapshot?: boolean;
	initialSnapshot?: Extract<ChatStreamEvent, { type: "session_snapshot" }>;
	release?: () => Promise<void>;
};

/**
 * Reads the requested SSE resume cursor from the request.
 *
 * @param request - The incoming request containing an optional `Last-Event-ID` header
 * @param url - The request URL containing an optional `lastEventId` query parameter
 * @returns A positive resume cursor, or `0` when none is provided or valid
 */
function lastEventIdFor(request: Request, url: URL): number {
	const raw = request.headers.get("last-event-id") ?? url.searchParams.get("lastEventId");
	const parsed = raw ? Number.parseInt(raw, 10) : 0;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Creates a server-sent events response for a chat or child-agent stream.
 *
 * @param request - The request whose abort signal terminates the stream
 * @param source - The stream source and metadata used to initialize and replay events
 * @param lastEventId - The client’s resume cursor
 * @returns An SSE response containing the stream events
 */
function createSseResponse(request: Request, bridge: PrimeBridge, source: SseSource, lastEventId: number): Response {
	const encoder = new TextEncoder();
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let removeListener: (() => void) | undefined;
	let cleaned = false;
	let released = false;

	const releaseSource = () => {
		if (released) return;
		released = true;
		const release = source.release;
		if (release) void release().catch(() => undefined);
	};

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
					"event: message\n",
					`data: ${JSON.stringify(chunk.data)}\n\n`,
				];
				enqueue(lines.join(""));
			};
			const cleanup = () => {
				if (cleaned) return;
				cleaned = true;
				closed = true;
				if (heartbeat) clearInterval(heartbeat);
				removeListener?.();
				releaseSource();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};

			// The connected frame is deliberately outside the ring buffer. It tells
			// the client which server-side stream key is carrying this child.
			const channelId = source.channelId ?? source.sessionId;
			let readyToFlush = false;
			let resyncSent = false;
			let liveCursor = source.replayFrom ?? lastEventId;
			let pendingQuestionIds: ReadonlySet<string> | null =
				liveCursor === 0
					? new Set(bridge.pendingDialogsFor(source.sessionId).map((dialog) => dialog.toolCallId))
					: null;
			const flush = () => {
				if (!readyToFlush || resyncSent || closed) return;
				const { replayed, overflowed } = bridge.replaySince(channelId, liveCursor);
				if (overflowed) {
					resyncSent = true;
					write({
						data: {
							type: "state",
							state: { name: "agent_settled", message: "resync-required" },
						},
					});
					pendingQuestionIds = null;
					return;
				}
				for (const entry of replayed) {
					liveCursor = entry.seq;
					const event = normalizeSseReplayEvent(entry.event);
					if (!shouldReplaySseEvent(event, pendingQuestionIds)) continue;
					write({ id: entry.seq, data: event });
					if (
						event &&
						typeof event === "object" &&
						(event as { type?: unknown }).type === "session_snapshot" &&
						(event as { terminal?: unknown }).terminal === true
					) {
						cleanup();
						return;
					}
				}
				pendingQuestionIds = null;
			};

			// Attach before writing the bootstrap so a frame emitted while the
			// response is being assembled is replayed after the snapshot.
			removeListener = bridge.addEventListener((sessionId) => {
				if (sessionId === channelId) flush();
			});
			write({
				data: {
					type: "connected",
					sessionId: source.sessionId,
					adapterCapabilities: FLEET_ADAPTER_CAPABILITIES,
					...(source.streamGeneration ? { streamGeneration: source.streamGeneration } : {}),
					...(source.cursorReset ? { cursorReset: true } : {}),
					...(source.resumeAccepted ? { resumeAccepted: true } : {}),
				},
			});
			if (source.includeSnapshot !== false && source.initialSnapshot) write({ data: source.initialSnapshot });
			readyToFlush = true;
			if (source.initialSnapshot?.terminal === true) {
				cleanup();
				return;
			}
			flush();
			if (closed || cleaned) return;

			heartbeat = setInterval(() => enqueue(": heartbeat\n\n"), 15_000);
			request.signal.addEventListener("abort", cleanup, { once: true });
		},
		cancel() {
			if (heartbeat) clearInterval(heartbeat);
			removeListener?.();
			releaseSource();
			cleaned = true;
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
}

/**
 * Handles GET requests for chat and child-agent Server-Sent Event streams.
 *
 * @param request - The incoming request containing stream identifiers and optional resume information
 * @returns An SSE response for the requested stream, or an error response when the request is invalid or the stream is unavailable
 */
export function handleChatEventsGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const url = new URL(request.url);
		const sessionIdParam = url.searchParams.get("sessionId");
		const parentSessionIdParam = url.searchParams.get("parentSessionId");
		const childIdParam = url.searchParams.get("childId");
		const streamGenerationParam = url.searchParams.get("streamGeneration");
		const hasChildQuery = parentSessionIdParam !== null || childIdParam !== null || streamGenerationParam !== null;

		if (hasChildQuery) {
			if (sessionIdParam || !parentSessionIdParam || !childIdParam) {
				return Response.json(
					{ message: "GET /api/chat/events requires both ?parentSessionId= and ?childId= for child streams" },
					{ status: 400 },
				);
			}
			const parentSessionId = SessionIdSchema.safeParse(parentSessionIdParam);
			const childId = SessionIdSchema.safeParse(childIdParam);
			if (!parentSessionId.success || !childId.success) {
				return Response.json({ message: "Invalid subagent stream identifiers" }, { status: 400 });
			}
			if (streamGenerationParam !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(streamGenerationParam)) {
				return Response.json({ message: "Invalid child stream generation" }, { status: 400 });
			}
			const childStream: RlmChildStream | undefined = await getBridge().openRlmChildStream(
				parentSessionId.data,
				childId.data,
				{
					...(streamGenerationParam ? { streamGeneration: streamGenerationParam } : {}),
					lastEventId: lastEventIdFor(request, url),
				},
			);
			if (!childStream) return Response.json({ message: "Unknown live subagent stream" }, { status: 404 });
			return createSseResponse(
				request,
				getBridge(),
				{
					sessionId: childStream.sessionId,
					channelId: childStream.channelId,
					streamGeneration: childStream.streamGeneration,
					resumeAccepted: childStream.resumeAccepted,
					cursorReset: childStream.cursorReset,
					replayFrom: childStream.replayFrom,
					includeSnapshot: childStream.includeSnapshot,
					initialSnapshot: childStream.snapshot,
					release: childStream.release,
				},
				lastEventIdFor(request, url),
			);
		}

		if (!sessionIdParam) return Response.json({ message: "SSE requires ?sessionId=" }, { status: 400 });
		const sessionId = SessionIdSchema.safeParse(sessionIdParam);
		if (!sessionId.success) return Response.json({ message: "Invalid session identifier" }, { status: 400 });
		return createSseResponse(request, getBridge(), { sessionId: sessionId.data }, lastEventIdFor(request, url));
	});
}
