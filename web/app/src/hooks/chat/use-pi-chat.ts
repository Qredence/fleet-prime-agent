import type {
	ChatMode,
	ChatModelSelection,
	ChatOpenUIArtifactUpsertRequest,
	ChatPlanAction,
	ChatQuestionAnswer,
	ChatQueueMutationKind,
	ChatQueueMutationRequest,
	ChatSessionInfo,
	ChatSessionMetadata,
	OpenUIHtmlArtifactPayload,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatAttachment, ProjectId } from "@prime-agent/web-protocol/fleet-contract";
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import type { ChatStore } from "@/hooks/chat/chat-store";
import { CLEARED_CONVERSATION, useChatStore } from "@/hooks/chat/chat-store";
import type { ChatClient } from "@/lib/chat/chat-client";
import { chatClient } from "@/lib/chat/chat-client";
import { notifyChatError } from "@/lib/chat/chat-error-notify";
import { EMPTY_QUEUE_STATE, EMPTY_SESSION_PRESENTATION } from "@/lib/chat/chat-stream-state";
import { hydratePlanPresentationMessages, planPresentationForToolCall } from "@/lib/chat/plan-presentation";
import { isPlanDecisionToolCall } from "@/lib/chat/plan-state";
import { resolvePlanDecisionMessages } from "@/hooks/chat/use-pi-chat-plan-decisions";
import { usePiChatMessaging, usePiChatSessionEvents } from "@/hooks/chat/use-pi-chat-stream";
import {
	runForbiddenSessionRecovery,
	tryRecoverForbiddenSession,
	tryRecoverUnknownSession,
} from "@/lib/chat/forbidden-session-recovery";
import { notify } from "@/lib/notify";
import { removeSessionOpenUIState } from "@/lib/openui/openui-state-cleanup";

export type SendMessageInput = {
	text: string;
	attachments?: Array<ChatAttachment>;
	openUI?: boolean;
	openUIArtifact?: boolean;
	planAction?: ChatPlanAction;
	mode?: ChatMode;
	/** Mirror of the Alt/Option modifier at Enter-press time. */
	altKey?: boolean;
};

export type OpenUIArtifactCandidate = Pick<ChatOpenUIArtifactUpsertRequest, "assistantMessageId" | "artifactIndex"> & {
	artifact: OpenUIHtmlArtifactPayload;
};

export type UsePiChatOptions = {
	client?: ChatClient;
	initialSessionMetadata: ChatSessionMetadata;
	projectId?: string;
	persistSession: (metadata: ChatSessionMetadata) => void;
};

type PiChatBootstrapOptions = {
	client: ChatClient;
	initialSessionMetadataRef: MutableRefObject<ChatSessionMetadata>;
	initializedRef: MutableRefObject<boolean>;
	resumeRequestRef: MutableRefObject<number>;
	recoverFromForbiddenSession: (projectIdOverride?: ProjectId | null, isCurrent?: () => boolean) => Promise<void>;
	refreshSessions: () => Promise<Array<ChatSessionInfo>>;
	store: ChatStore;
};

/** Initial session list + load; exported for focused tests. */
export function usePiChatBootstrap({
	client,
	initialSessionMetadataRef,
	initializedRef,
	resumeRequestRef,
	recoverFromForbiddenSession,
	refreshSessions,
	store,
}: PiChatBootstrapOptions) {
	useEffect(() => {
		if (initializedRef.current) return;
		initializedRef.current = true;
		const controller = new AbortController();
		const generation = resumeRequestRef.current;
		const isCurrent = () => !controller.signal.aborted && resumeRequestRef.current === generation;
		let completed = false;
		store.patch({ ...CLEARED_CONVERSATION, error: null, status: "ready" });

		const storedSession = initialSessionMetadataRef.current;
		void refreshSessions()
			.then((availableSessions) => {
				if (!isCurrent()) return undefined;
				const selected = storedSession.sessionId
					? availableSessions.find((candidate) => candidate.sessionId === storedSession.sessionId)
					: undefined;
				const fallback =
					selected ??
					(storedSession.projectId
						? availableSessions.find((candidate) => candidate.projectId === storedSession.projectId)
						: availableSessions[0]);
				if (!fallback) {
					store.patch({ sessionMetadata: storedSession.projectId ? { projectId: storedSession.projectId } : {} });
					return undefined;
				}
				const metadata = selected
					? storedSession
					: { sessionId: fallback.sessionId, projectId: fallback.projectId };
				return client.loadSession(metadata);
			})
			.then((result) => {
				if (!result || !isCurrent()) return;
				store.patch({
					activityLabel: result.sessionReset ? "Started a fresh Pi session" : undefined,
					messages: hydratePlanPresentationMessages(result.messages, result.planPresentations),
					presentation: result.presentation,
					sessionMetadata: result.session,
				});
			})
			.catch(async (err) => {
				if (!isCurrent()) return;
				const context = { store, isCurrent };
				const recover = () => recoverFromForbiddenSession(undefined, isCurrent);
				const recovered =
					(await tryRecoverForbiddenSession(err, recover, context)) ||
					(await tryRecoverUnknownSession(err, recover, context));
				if (recovered || !isCurrent()) return;
				const nextError = err instanceof Error ? err : new Error(String(err));
				store.patch({ error: nextError, status: "error" });
				notifyChatError(nextError);
			})
			.finally(() => {
				completed = true;
			});

		return () => {
			controller.abort();
			if (!completed) initializedRef.current = false;
		};
	}, [
		client,
		initialSessionMetadataRef,
		initializedRef,
		resumeRequestRef,
		recoverFromForbiddenSession,
		refreshSessions,
		store,
	]);
}

/**
 * Provides chat state and controls for managing Pi sessions, messages, streaming, queues, and presentations.
 *
 * @param model - The model selection used for chat responses.
 * @param options - Configuration for the chat client, initial session, persistence, and project context.
 * @returns The current chat state and operations for interacting with sessions and messages.
 */
export function usePiChat(model: ChatModelSelection | undefined, options: UsePiChatOptions) {
	const { client = chatClient, initialSessionMetadata, persistSession, projectId } = options;
	const [{ activityLabel, error, messages, planLabel, presentation, queue, sessionMetadata, status }, store] =
		useChatStore(initialSessionMetadata, persistSession);
	const [sessions, setSessions] = useState<Array<ChatSessionInfo>>([]);
	const initialSessionMetadataRef = useRef(initialSessionMetadata);
	const projectIdRef = useRef(projectId);
	const queuedMutationTailRef = useRef<Promise<unknown> | null>(null);
	const pendingSendControllerRef = useRef<AbortController | null>(null);
	const streamControllersRef = useRef(new Map<string, AbortController>());
	const refreshSessionsPromiseRef = useRef<Promise<Array<ChatSessionInfo>> | null>(null);
	const resumeRequestRef = useRef(0);
	const initializedRef = useRef(false);
	const sendMessageRef = useRef<(input: SendMessageInput) => Promise<boolean>>(() => Promise.resolve(false));

	// Append an assistant-role message from the web UI itself (never sent to
	// prime-agent). Used by slash-command handlers (/session /context /logs
	// /export /reload /fast …) to echo the result into the conversation the
	// way the TUI's `showStatus`/`showError` does. Not persisted to disk —
	// these are modal echoes for the user, not transcript entries the agent
	// should reason over.
	const appendLocalMessage = useCallback(
		(text: string) => {
			store.patch((current) => ({
				messages: [
					...current.messages,
					{
						id: crypto.randomUUID(),
						role: "assistant" as const,
						source: "local",
						createdAt: Date.now(),
						parts: [{ type: "text" as const, text }],
					},
				],
			}));
		},
		[store],
	);

	const persistOpenUIArtifact = useCallback(
		async (candidate: OpenUIArtifactCandidate): Promise<string | undefined> => {
			const sessionId = store.read().sessionMetadata.sessionId;
			if (!sessionId) return undefined;
			const result = await client.upsertOpenUIArtifact({ sessionId, ...candidate });
			if (store.read().sessionMetadata.sessionId === sessionId) {
				store.patch({ presentation: result.presentation });
			}
			return result.artifact.id;
		},
		[client, store],
	);
	useEffect(() => {
		projectIdRef.current = projectId;
	}, [projectId]);

	const refreshSessions = useCallback(async () => {
		const pendingRefresh = refreshSessionsPromiseRef.current;
		if (pendingRefresh) return pendingRefresh;

		const refreshRequest = client.listSessions().then((nextSessions) => {
			setSessions(nextSessions);
			return nextSessions;
		});
		refreshSessionsPromiseRef.current = refreshRequest;

		try {
			return await refreshRequest;
		} finally {
			if (refreshSessionsPromiseRef.current === refreshRequest) {
				refreshSessionsPromiseRef.current = null;
			}
		}
	}, [client]);

	const recoverFromForbiddenSession = useCallback(
		// An override recovers into the project the caller asked to resume,
		// instead of the hook-level default captured at mount.
		(projectIdOverride?: ProjectId | null, ownsSelection?: () => boolean) => {
			const generation = resumeRequestRef.current;
			return runForbiddenSessionRecovery({
				isCurrent: ownsSelection ?? (() => resumeRequestRef.current === generation),
				client,
				projectId: projectIdOverride ?? projectIdRef.current,
				refreshSessions,
				store,
			});
		},
		[client, refreshSessions, store],
	);

	const submitQuestionAnswer = useCallback(
		async ({ toolCallId, answer }: { toolCallId?: string; answer: ChatQuestionAnswer }) => {
			if (isPlanDecisionToolCall(toolCallId)) {
				const nextMessages = resolvePlanDecisionMessages(store.read().messages, toolCallId, answer);
				store.patch({ messages: nextMessages });
				const presentation = planPresentationForToolCall(nextMessages, toolCallId);
				const sessionId = store.read().sessionMetadata.sessionId;
				if (presentation && sessionId) {
					await client.upsertPlanPresentation({ sessionId, presentation }).catch(() => undefined);
				}
				const selected = answer.selectedIds?.[0];
				if (selected === "execute") {
					await sendMessageRef.current({
						text: "Execute the approved plan.",
						mode: "agent",
						planAction: "execute",
						openUI: true,
					});
					// The run settled; drop the persisted "executing" state so reloads
					// do not show a stale in-flight plan card.
					const settledPresentation = planPresentationForToolCall(store.read().messages, toolCallId);
					const settledSessionId = store.read().sessionMetadata.sessionId;
					if (settledPresentation && settledSessionId) {
						await client
							.upsertPlanPresentation({
								sessionId: settledSessionId,
								presentation: {
									...settledPresentation,
									state: { ...settledPresentation.state, executing: false },
								},
							})
							.catch(() => undefined);
					}
					if (settledPresentation) {
						// Keep the visible card in sync with the settled record: without
						// this the in-memory presentation keeps showing "executing".
						store.patch((current) => ({
							messages: current.messages.map((message) => {
								if (message.role !== "assistant") return message;
								return {
									...message,
									parts: message.parts.map((part) => {
										if (
											part.type !== "tool-PlanWrite" ||
											part.toolCallId !== toolCallId ||
											!part.input ||
											typeof part.input !== "object"
										) {
											return part;
										}
										const input = part.input as Record<string, unknown>;
										const presentation = input.presentation;
										if (!presentation || typeof presentation !== "object") return part;
										return {
											...part,
											input: {
												...input,
												executing: false,
												presentation: { ...presentation, executing: false },
											},
										};
									}),
								};
							}),
						}));
					}
				} else if (selected === "refine" || answer.text?.trim()) {
					await sendMessageRef.current({
						text: answer.text?.trim() || "Refine the plan.",
						mode: "plan",
						planAction: "refine",
						openUI: true,
					});
				}
				return { ok: true };
			}
			const result = await client.answerQuestion({
				sessionId: store.read().sessionMetadata.sessionId,
				toolCallId,
				answer,
			});

			if (result.message) {
				await sendMessageRef.current({
					text: result.message,
					planAction: result.planAction,
				});
			}

			return result;
		},
		[client, store],
	);

	useEffect(() => {
		initialSessionMetadataRef.current = initialSessionMetadata;
	}, [initialSessionMetadata]);

	useEffect(() => {
		const controllers = streamControllersRef.current;
		return () => {
			pendingSendControllerRef.current?.abort();
			pendingSendControllerRef.current = null;
			for (const controller of controllers.values()) controller.abort();
			controllers.clear();
		};
	}, []);

	usePiChatBootstrap({
		client,
		initialSessionMetadataRef,
		initializedRef,
		resumeRequestRef,
		recoverFromForbiddenSession,
		refreshSessions,
		store,
	});

	const { cancelStreamRecovery, resetStreamAdmission, sendMessage, streamRecoveryRef } = usePiChatMessaging({
		client,
		model,
		pendingSendControllerRef,
		projectId,
		recoverFromForbiddenSession,
		refreshSessions,
		store,
		streamControllersRef,
	});

	const stop = useCallback(() => {
		cancelStreamRecovery();
		const metadata = store.read().sessionMetadata;
		resetStreamAdmission(metadata.sessionId);
		pendingSendControllerRef.current?.abort();
		pendingSendControllerRef.current = null;
		if (metadata.sessionId) {
			void client.abortSession(metadata).catch(() => undefined);
			streamControllersRef.current.get(metadata.sessionId)?.abort();
			streamControllersRef.current.delete(metadata.sessionId);
		}
		store.patch((current) => ({
			activityLabel: undefined,
			queue: EMPTY_QUEUE_STATE,
			queueRevision: current.queueRevision + 1,
			status: "ready",
		}));
	}, [cancelStreamRecovery, client, resetStreamAdmission, store]);

	const mutateQueuedMessage = useCallback(
		(
			lane: ChatQueueMutationRequest["lane"],
			index: number,
			expectedText: string,
			mutation: ChatQueueMutationKind,
			options?: { staleMessage?: string },
		) => {
			const requested = store.read();
			const originatingSessionId = requested.sessionMetadata.sessionId;
			const requestedRevision = requested.queueRevision;
			const requestedItems = lane === "steering" ? requested.queue.steering : requested.queue.followUp;
			const requestedMatchCount = requestedItems.filter((item) => item === expectedText).length;
			const previousMutation = queuedMutationTailRef.current ?? Promise.resolve();
			const queuedMutation = previousMutation
				.catch(() => undefined)
				.then(async () => {
					if (!originatingSessionId || store.read().sessionMetadata.sessionId !== originatingSessionId)
						return false;
					const refuseStaleMutation = (expectedRace: boolean) => {
						if (!expectedRace && options?.staleMessage) {
							notifyChatError(new Error(options.staleMessage));
						}
						return false;
					};
					const current = store.read().queue;
					const items = lane === "steering" ? current.steering : current.followUp;
					let resolvedIndex: number | undefined;
					if (store.read().queueRevision === requestedRevision) {
						resolvedIndex = items[index] === expectedText ? index : undefined;
					} else {
						if (requestedMatchCount !== 1) return refuseStaleMutation(true);
						// Queue snapshots expose text only, so a unique match in both snapshots
						// is the only safe way to resolve an item after a revision.
						const currentMatches = items.reduce<Array<number>>((matches, item, itemIndex) => {
							if (item === expectedText) matches.push(itemIndex);
							return matches;
						}, []);
						resolvedIndex = currentMatches.length === 1 ? currentMatches[0] : undefined;
					}
					if (resolvedIndex === undefined)
						return refuseStaleMutation(store.read().queueRevision !== requestedRevision);

					const optimistic =
						mutation.type === "delete"
							? {
									...current,
									[lane]: items.filter((_, itemIndex) => itemIndex !== resolvedIndex),
								}
							: {
									...current,
									[lane]: items.map((item, itemIndex) => (itemIndex === resolvedIndex ? mutation.text : item)),
								};
					store.patch({ queue: optimistic });
					const requestRevision = store.read().queueRevision;

					try {
						const result = await client.mutateQueuedMessage({
							sessionId: originatingSessionId,
							lane,
							index: resolvedIndex,
							expectedText,
							mutation,
						});
						const settled = store.read();
						if (
							settled.sessionMetadata.sessionId !== originatingSessionId ||
							settled.queueRevision !== requestRevision
						) {
							return result.status === "applied";
						}
						store.patch({ queue: result.queue });
						return result.status === "applied";
					} catch (queueError) {
						const settled = store.read();
						if (
							settled.sessionMetadata.sessionId === originatingSessionId &&
							settled.queueRevision === requestRevision &&
							settled.queue === optimistic
						) {
							store.patch({ queue: current });
						}
						throw queueError;
					}
				});
			queuedMutationTailRef.current = queuedMutation.then(
				() => undefined,
				() => undefined,
			);
			return queuedMutation;
		},
		[client, store],
	);

	const deleteQueuedMessage = useCallback(
		(lane: ChatQueueMutationRequest["lane"], index: number, expectedText: string) =>
			mutateQueuedMessage(
				lane,
				index,
				expectedText,
				{ type: "delete" },
				{
					staleMessage: "The queued message changed before it could be deleted.",
				},
			),
		[mutateQueuedMessage],
	);

	const editQueuedMessage = useCallback(
		(lane: ChatQueueMutationRequest["lane"], index: number, expectedText: string, nextText: string) =>
			mutateQueuedMessage(
				lane,
				index,
				expectedText,
				{ type: "replace", text: nextText, lane },
				{ staleMessage: "The queued message changed before it could be updated." },
			),
		[mutateQueuedMessage],
	);

	/**
	 * Creates a session and adopts it only if no newer create or resume request has started.
	 * Passing `preserveRunning: false` stops the active session before creating the replacement.
	 *
	 * @throws If session creation or the subsequent session-list refresh fails.
	 */
	const startNewSession = useCallback(
		async (options?: { projectId?: string; preserveRunning?: boolean }) => {
			cancelStreamRecovery();
			const requestId = resumeRequestRef.current + 1;
			resumeRequestRef.current = requestId;
			const isCurrent = () => resumeRequestRef.current === requestId;
			if (options?.preserveRunning === false) stop();
			else store.patch((current) => ({ queueRevision: current.queueRevision + 1, status: "ready" }));
			const result = await client.createSession(options?.projectId ?? projectIdRef.current ?? projectId);
			if (!isCurrent()) return;
			store.patch({
				...CLEARED_CONVERSATION,
				presentation: result.presentation,
				sessionMetadata: result.session,
				// A turn started on the previous session can mark this composer streaming
				// while createSession is in flight. The new session is idle unless its
				// own stream controller is already registered.
				status: streamControllersRef.current.has(result.session.sessionId ?? "") ? "streaming" : "ready",
			});
			notify.success("New session started");
			await refreshSessions();
		},
		[cancelStreamRecovery, client, projectId, refreshSessions, stop, store],
	);

	const resumeSession = useCallback(
		async (metadata: ChatSessionMetadata, options?: { preserveRunning?: boolean }) => {
			cancelStreamRecovery();
			const requestId = resumeRequestRef.current + 1;
			resumeRequestRef.current = requestId;
			const isCurrent = () => resumeRequestRef.current === requestId;
			store.invalidateQueue();
			try {
				if (options?.preserveRunning === false) stop();
				const result = await client.resumeSession(metadata);
				if (!isCurrent()) return false;
				store.patch({
					...CLEARED_CONVERSATION,
					activityLabel: result.sessionReset ? "Started a fresh Pi session" : undefined,
					messages: hydratePlanPresentationMessages(result.messages, result.planPresentations),
					presentation: result.presentation,
					sessionMetadata: result.session,
					status: streamControllersRef.current.has(result.session.sessionId ?? "") ? "streaming" : "ready",
				});
				await refreshSessions();
				return isCurrent();
			} catch (err) {
				// A newer resume may have selected a session while this request was
				// in flight. Do not let its recovery replace that newer selection.
				if (!isCurrent()) return false;
				// Recover into the project this resume targeted; mid-switch the
				// hook-level default may still point at the previous project.
				const context = { store, isCurrent };
				const recover = () => recoverFromForbiddenSession(metadata.projectId, isCurrent);
				const recovered =
					(await tryRecoverForbiddenSession(err, recover, context)) ||
					(await tryRecoverUnknownSession(err, recover, context));
				if (!isCurrent() || recovered) return false;
				const nextError = err instanceof Error ? err : new Error(String(err));
				store.patch({ error: nextError, status: "error" });
				notifyChatError(nextError);
				return false;
			}
		},
		[cancelStreamRecovery, client, recoverFromForbiddenSession, refreshSessions, stop, store],
	);

	const switchProject = useCallback(
		async (nextProjectId: string, nextSessionId?: string) => {
			if (nextSessionId) {
				return resumeSession({ sessionId: nextSessionId, projectId: nextProjectId }, { preserveRunning: true });
			}
			cancelStreamRecovery();
			store.patch((current) => ({
				...CLEARED_CONVERSATION,
				queueRevision: current.queueRevision + 1,
				sessionMetadata: { projectId: nextProjectId },
				status: "ready",
			}));
			return true;
		},
		[cancelStreamRecovery, resumeSession, store],
	);

	useEffect(() => {
		sendMessageRef.current = sendMessage;
	}, [sendMessage]);

	usePiChatSessionEvents({
		client,
		recoveryRef: streamRecoveryRef,
		sessionId: sessionMetadata.sessionId,
		store,
	});

	const renameSession = useCallback(
		async (sessionId: string, title: string): Promise<boolean> => {
			try {
				await client.renameSession(sessionId, title);
				await refreshSessions();
				return true;
			} catch (err) {
				notifyChatError(err);
				return false;
			}
		},
		[client, refreshSessions],
	);
	/**
	 * Deletes a session, clearing the conversation only if that session is still active when deletion completes.
	 *
	 * @returns `false` when deletion fails; otherwise `true` after refreshing the session list.
	 * @throws If refreshing the session list fails after deletion.
	 */
	const deleteSession = useCallback(
		async (sessionId: string): Promise<boolean> => {
			if (store.read().sessionMetadata.sessionId === sessionId) stop();
			try {
				await client.deleteSession(sessionId);
				removeSessionOpenUIState(sessionId);
			} catch (err) {
				notifyChatError(err);
				return false;
			}
			if (store.read().sessionMetadata.sessionId === sessionId) {
				store.patch({ messages: [], presentation: EMPTY_SESSION_PRESENTATION, sessionMetadata: {} });
			}
			await refreshSessions();
			return true;
		},
		[client, refreshSessions, stop, store],
	);

	const getSessionMetadata = useCallback(() => store.read().sessionMetadata, [store]);
	const getMessages = useCallback(() => store.read().messages, [store]);
	const setError = useCallback((nextError: Error | null) => store.patch({ error: nextError }), [store]);

	return {
		activityLabel,
		answerQuestion: submitQuestionAnswer,
		appendLocalMessage,
		deleteQueuedMessage,
		editQueuedMessage,
		deleteSession,
		error,
		getMessages,
		getSessionMetadata,
		messages,
		planLabel,
		presentation,
		persistOpenUIArtifact,
		queue,
		renameSession,
		refreshSessions,
		resumeSession,
		sendMessage,
		sessionMetadata,
		sessions,
		setError,
		startNewSession,
		status,
		stop,
		switchProject,
	};
}
