import type { ImageContent } from "@earendil-works/pi-ai";
import { FLEET_ADAPTER_CAPABILITIES } from "@prime-agent/web-protocol/chat-protocol";
import { ChatRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import type { ChatAttachment } from "@prime-agent/web-protocol/fleet-contract";
import { readInspectedManagedAttachment, validateManagedAttachments } from "../managed-attachments";
import { parseBackendSessionCommand, sessionCommandResultText } from "../session-commands";
import { getBridge } from "../singleton";
import { safeErrorMessage, wrapApiHandler } from "../wrap-api-handler";

export function resolveChatStreamingBehavior(streamingBehavior?: "steer" | "followUp"): "steer" | "followUp" {
	return streamingBehavior ?? "steer";
}

export function chooseChatStartId(
	mapperState: { inRun: boolean; currentMessageId: string | undefined },
	streamingBehavior?: "steer" | "followUp",
	sessionIsStreaming = false,
): string {
	// Only a queued steer/follow-up may continue the active assistant bubble.
	// A normal send must get a fresh id even if an interrupted run left the
	// mapper marked in-flight; otherwise its deltas can replace an older turn.
	if (sessionIsStreaming && streamingBehavior && mapperState.inRun && mapperState.currentMessageId) {
		return mapperState.currentMessageId;
	}
	return crypto.randomUUID();
}

export function handleChatPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json();
		const body = ChatRequestSchema.parse(raw);
		const { sessionId, message, model, mode, openUI, planAction } = body;
		if (!message || typeof message !== "string") {
			return Response.json({ message: "POST /api/chat requires a `message` string." }, { status: 400 });
		}

		const bridge = getBridge();
		const targetSessionId = sessionId;
		if (!targetSessionId) {
			return Response.json({ message: "POST /api/chat requires a `sessionId`." }, { status: 400 });
		}
		if (process.env.PRIME_BRIDGE_DEBUG === "1") {
			process.stderr.write(`[chat] received session=${targetSessionId.slice(0, 8)} bytes=${message.length}\n`);
		}
		const session = bridge.getSession(targetSessionId) ?? (await bridge.resumeSessionById(targetSessionId));
		if (!session) {
			return Response.json({ message: `Unknown session: ${targetSessionId}` }, { status: 404 });
		}
		const uploadAttachments = (body.attachments ?? []).filter(
			(attachment): attachment is Extract<ChatAttachment, { kind: "upload" }> => attachment.kind === "upload",
		);
		let uploadInspections: Awaited<ReturnType<typeof validateManagedAttachments>>;
		try {
			uploadInspections = await validateManagedAttachments(session, uploadAttachments);
		} catch (error) {
			if (error instanceof Error && "status" in error && (error.status === 400 || error.status === 413)) {
				return Response.json({ message: error.message }, { status: error.status });
			}
			throw error;
		}
		const images: Array<ImageContent> = [];
		const attachmentContext: string[] = [];
		for (const attachment of body.attachments ?? []) {
			if (attachment.kind === "workspace") {
				attachmentContext.push(`[Workspace attachment: ${attachment.relativePath}]`);
				continue;
			}
			const inspected = uploadInspections.get(attachment.attachmentId);
			const managed = inspected ? await readInspectedManagedAttachment(inspected).catch(() => undefined) : undefined;
			if (!managed) {
				return Response.json({ message: `Unknown attachment: ${attachment.attachmentId}` }, { status: 400 });
			}
			const mimeType = managed.metadata.mimeType;
			if (mimeType.startsWith("image/")) {
				images.push({ type: "image", data: managed.data.toString("base64"), mimeType });
			} else if (mimeType.startsWith("text/") || mimeType === "application/json") {
				attachmentContext.push(
					`<attachment name="${managed.metadata.name}">\n${managed.data.toString("utf8")}\n</attachment>`,
				);
			} else {
				attachmentContext.push(`[Attached file: ${managed.metadata.name} (${managed.metadata.mimeType})]`);
			}
		}
		const promptMessage = attachmentContext.length > 0 ? `${message}\n\n${attachmentContext.join("\n\n")}` : message;
		const backendSessionCommand = parseBackendSessionCommand(promptMessage);
		const initialRefinementCount = session.mapperState.presentation.refinements.length;
		if (model !== undefined) {
			await bridge.setModel(session.sessionId, model);
			if (typeof model === "object" && typeof model.thinkingLevel === "string") {
				await session.connection.setThinkingLevel(model.thinkingLevel);
			}
		}
		if (process.env.PRIME_BRIDGE_DEBUG === "1") {
			const state = await session.connection.getState();
			process.stderr.write(`[chat] session resolved; prompt len=${state.messageCount}\n`);
		}

		const encoder = new TextEncoder();

		let removeListener: (() => void) | undefined;
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				let closed = false;
				const close = () => {
					if (closed) return;
					closed = true;
					removeListener?.();
					try {
						controller.close();
					} catch {
						/* already closed */
					}
				};
				const write = (frame: unknown) => {
					if (closed) return;
					try {
						controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
					} catch {
						/* stream already cancelled */
					}
				};

				removeListener = bridge.addEventListener((sid, frame) => {
					if (sid !== session.sessionId) return;
					// Session commands share the session-wide event stream with the
					// active turn. Their POST response only needs the request-scoped
					// synthetic completion below; the SSE stream owns live turn frames.
					if (backendSessionCommand) return;
					write(frame);
					if (frame.type === "error" || frame.type === "done") {
						close();
					}
				});

				const streamingBehavior = resolveChatStreamingBehavior(body.streamingBehavior);
				const startId = chooseChatStartId(session.mapperState, streamingBehavior, session.isStreaming);
				const startRunId = session.mapperState.inRun ? session.mapperState.runId : "pending";
				write({
					type: "start",
					id: startId,
					runId: startRunId,
					sessionId: session.sessionId,
					requestKind: backendSessionCommand ? "session-command" : undefined,
					adapterCapabilities: FLEET_ADAPTER_CAPABILITIES,
				});
				if (process.env.PRIME_BRIDGE_DEBUG === "1") {
					process.stderr.write(`[chat] wrote start; firing prompt\n`);
				}

				void bridge
					.prompt(session.sessionId, promptMessage, {
						images,
						streamingBehavior,
						mode,
						openUI,
						planAction,
					})
					.then(() => {
						if (!backendSessionCommand) return;
						write({
							type: "done",
							runId: startRunId,
							sessionId: session.sessionId,
							message: {
								id: crypto.randomUUID(),
								role: "assistant",
								source: "local",
								createdAt: Date.now(),
								parts: [
									{
										type: "text",
										text: sessionCommandResultText(
											backendSessionCommand,
											bridge.getPresentation(session.sessionId),
											initialRefinementCount,
										),
									},
								],
							},
							requestKind: "session-command",
						});
						close();
					})
					.catch((error) => {
						process.stderr.write(
							`[chat] prompt errored: ${error instanceof Error ? error.message : String(error)}\n`,
						);
						write({
							type: "error",
							message: safeErrorMessage(error),
						});
						close();
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
