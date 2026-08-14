import { ChatRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

export function handleChatPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json();
		const body = ChatRequestSchema.parse(raw);
		const { sessionId, sessionFile, message, model } = body;
		if (!message || typeof message !== "string") {
			return Response.json({ message: "POST /api/chat requires a `message` string." }, { status: 400 });
		}

		const bridge = getBridge();
		const targetSessionId = sessionId ?? sessionFile;
		if (!targetSessionId) {
			return Response.json(
				{ message: "POST /api/chat requires a `sessionId` (or `sessionFile`)." },
				{ status: 400 },
			);
		}
		if (process.env.PRIME_BRIDGE_DEBUG === "1") {
			process.stderr.write(`[chat] received session=${targetSessionId.slice(0, 8)} bytes=${message.length}\n`);
		}
		const session = bridge.getSession(targetSessionId) ?? (await bridge.resumeSessionById(targetSessionId));
		if (!session) {
			return Response.json({ message: `Unknown session: ${targetSessionId}` }, { status: 404 });
		}
		if (model !== undefined) {
			await bridge.setModel(session.sessionId, model);
			if (typeof model === "object" && typeof model.thinkingLevel === "string") {
				session.session.setThinkingLevel(model.thinkingLevel);
			}
		}
		if (process.env.PRIME_BRIDGE_DEBUG === "1") {
			process.stderr.write(
				`[chat] session resolved; prompt len=${session.session.sessionManager.buildSessionContext().messages.length}\n`,
			);
		}

		const encoder = new TextEncoder();

		let removeListener: (() => void) | undefined;
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				const write = (frame: unknown) => {
					try {
						controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
					} catch {
						/* stream already cancelled */
					}
				};

				removeListener = bridge.addEventListener((sid, frame) => {
					if (sid !== session.sessionId) return;
					write(frame);
					if (frame.type === "done" || frame.type === "error") {
						removeListener?.();
						try {
							controller.close();
						} catch {
							/* already closed */
						}
					}
				});

				const startId = session.mapperState.inRun
					? (session.mapperState.currentMessageId ?? crypto.randomUUID())
					: crypto.randomUUID();
				write({
					type: "start",
					id: startId,
					runId: session.mapperState.inRun ? session.mapperState.runId : "pending",
					sessionId: session.sessionId,
					sessionFile: session.sessionPath,
				});
				if (process.env.PRIME_BRIDGE_DEBUG === "1") {
					process.stderr.write(`[chat] wrote start; firing prompt\n`);
				}

				void bridge
					.prompt(session.sessionId, message, {
						streamingBehavior: body.streamingBehavior,
					})
					.catch((error) => {
						process.stderr.write(
							`[chat] prompt errored: ${error instanceof Error ? error.message : String(error)}\n`,
						);
						write({
							type: "error",
							message: error instanceof Error ? error.message : String(error),
						});
						removeListener?.();
						try {
							controller.close();
						} catch {
							/* already closed */
						}
					});
			},
			cancel() {
				removeListener?.();
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "application/x-ndjson; charset=utf-8",
				"Cache-Control": "no-cache, no-store",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			},
		});
	});
}
