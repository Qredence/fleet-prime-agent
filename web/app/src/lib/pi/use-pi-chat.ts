import { notify } from "@prime-agent/web-design/lib/notify";
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
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { ChatAttachment, ProjectId } from "@prime-agent/web-protocol/fleet-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatClient } from "./chat-client";
import { chatClient } from "./chat-client";
import { notifyChatError } from "./chat-error-notify";
import type { QueueState } from "./chat-fetch";
import { EMPTY_QUEUE_STATE, normalizeSessionMetadata } from "./chat-stream-state";
import { hydratePlanPresentationMessages, planPresentationForToolCall } from "./plan-presentation";
import { isPlanDecisionToolCall } from "./plan-state";
import { usePiChatBootstrap } from "./use-pi-chat-bootstrap";
import { usePiChatSessionEvents } from "./use-pi-chat-events";
import {
	runForbiddenSessionRecovery,
	tryRecoverForbiddenSession,
	tryRecoverUnknownSession,
} from "./use-pi-chat-forbidden-session";
import { usePiChatMessaging } from "./use-pi-chat-messaging";
import { enhancePlanDecisionMessages, resolvePlanDecisionMessages } from "./use-pi-chat-plan-decisions";

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

/**
 * Provides chat state and controls for managing Pi sessions, messages, streaming, queues, and presentations.
 *
 * @param model - The model selection used for chat responses.
 * @param options - Configuration for the chat client, initial session, persistence, and project context.
 * @returns The current chat state and operations for interacting with sessions and messages.
 */
export function usePiChat(model: ChatModelSelection | undefined, options: UsePiChatOptions) {
	const { client = chatClient, initialSessionMetadata, persistSession, projectId } = options;
	const [messages, setMessages] = useState<Array<ChatMessage>>([]);
	const [status, setStatus] = useState<ChatStatus>("ready");
	const [error, setError] = useState<Error | null>(null);
	const [sessionMetadata, setSessionMetadata] = useState<ChatSessionMetadata>(() => initialSessionMetadata);
	const [sessions, setSessions] = useState<Array<ChatSessionInfo>>([]);
	const [activityLabel, setActivityLabel] = useState<string | undefined>();
	const [planLabel, setPlanLabel] = useState<string | undefined>();
	const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE_STATE);
	const [presentation, setPresentation] = useState<PrimeAgentSessionPresentation>(() => ({
		revision: 0,
		userBash: [],
		rlmChildren: [],
		refinements: [],
		artifactRuns: [],
	}));
	const initialSessionMetadataRef = useRef(initialSessionMetadata);
	const projectIdRef = useRef(projectId);
	const messagesRef = useRef(messages);
	const sessionMetadataRef = useRef(sessionMetadata);
	const activityLabelRef = useRef(activityLabel);
	const planLabelRef = useRef(planLabel);
	const queueRef = useRef(queue);
	const queueRevisionRef = useRef(0);
	const queuedMutationTailRef = useRef<Promise<unknown> | null>(null);
	const presentationRef = useRef(presentation);
	const pendingSendControllerRef = useRef<AbortController | null>(null);
	const streamControllersRef = useRef(new Map<string, AbortController>());
	const refreshSessionsPromiseRef = useRef<Promise<Array<ChatSessionInfo>> | null>(null);
	const resumeRequestRef = useRef(0);
	const statusRef = useRef(status);
	const initializedRef = useRef(false);
	const sendMessageRef = useRef<(input: SendMessageInput) => Promise<boolean>>(() => Promise.resolve(false));
	const setMessagesSynced = useCallback(
		(updater: Array<ChatMessage> | ((current: Array<ChatMessage>) => Array<ChatMessage>)) => {
			const next = typeof updater === "function" ? updater(messagesRef.current) : updater;
			messagesRef.current = next;
			setMessages(next);
		},
		[],
	);

	// Append an assistant-role message from the web UI itself (never sent to
	// prime-agent). Used by slash-command handlers (/session /context /logs
	// /export /reload /fast …) to echo the result into the conversation the
	// way the TUI's `showStatus`/`showError` does. Not persisted to disk —
	// these are modal echoes for the user, not transcript entries the agent
	// should reason over.
	const appendLocalMessage = useCallback(
		(text: string) => {
			setMessagesSynced((current) => [
				...current,
				{
					id: crypto.randomUUID(),
					role: "assistant" as const,
					source: "local",
					createdAt: Date.now(),
					parts: [{ type: "text" as const, text }],
				},
			]);
		},
		[setMessagesSynced],
	);

	const setSessionMetadataSynced = useCallback(
		(metadata: ChatSessionMetadata) => {
			const current = sessionMetadataRef.current;
			const next = normalizeSessionMetadata(metadata);
			if (current.sessionId === next.sessionId && current.projectId === next.projectId) {
				return;
			}

			queueRevisionRef.current += 1;
			sessionMetadataRef.current = next;
			setSessionMetadata(next);
			persistSession(next);
		},
		[persistSession],
	);

	const setActivityLabelSynced = useCallback((nextLabel: string | undefined) => {
		activityLabelRef.current = nextLabel;
		setActivityLabel(nextLabel);
	}, []);

	const setPlanLabelSynced = useCallback((nextLabel: string | undefined) => {
		planLabelRef.current = nextLabel;
		setPlanLabel(nextLabel);
	}, []);

	const setQueueSynced = useCallback((nextQueue: QueueState) => {
		queueRevisionRef.current += 1;
		queueRef.current = nextQueue;
		setQueue(nextQueue);
	}, []);

	const invalidateQueueMutations = useCallback(() => {
		queueRevisionRef.current += 1;
	}, []);

	const setPresentationSynced = useCallback((nextPresentation: PrimeAgentSessionPresentation) => {
		presentationRef.current = nextPresentation;
		setPresentation(nextPresentation);
	}, []);

	const persistOpenUIArtifact = useCallback(
		async (candidate: OpenUIArtifactCandidate): Promise<string | undefined> => {
			const sessionId = sessionMetadataRef.current.sessionId;
			if (!sessionId) return undefined;
			const result = await client.upsertOpenUIArtifact({ sessionId, ...candidate });
			if (sessionMetadataRef.current.sessionId === sessionId) setPresentationSynced(result.presentation);
			return result.artifact.id;
		},
		[client, setPresentationSynced],
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
		(projectIdOverride?: ProjectId | null) =>
			runForbiddenSessionRecovery({
				client,
				projectId: projectIdOverride ?? projectIdRef.current,
				refreshSessions,
				setActivityLabelSynced,
				setError,
				setMessagesSynced,
				setPlanLabelSynced,
				setPresentationSynced,
				setQueueSynced,
				setSessionMetadataSynced,
				setStatus,
			}),
		[
			client,
			refreshSessions,
			setActivityLabelSynced,
			setMessagesSynced,
			setPlanLabelSynced,
			setPresentationSynced,
			setQueueSynced,
			setSessionMetadataSynced,
		],
	);

	const submitQuestionAnswer = useCallback(
		async ({ toolCallId, answer }: { toolCallId?: string; answer: ChatQuestionAnswer }) => {
			if (isPlanDecisionToolCall(toolCallId)) {
				const nextMessages = resolvePlanDecisionMessages(messagesRef.current, toolCallId, answer);
				setMessagesSynced(nextMessages);
				const presentation = planPresentationForToolCall(nextMessages, toolCallId);
				if (presentation && sessionMetadataRef.current.sessionId) {
					await client
						.upsertPlanPresentation({
							sessionId: sessionMetadataRef.current.sessionId,
							presentation,
						})
						.catch(() => undefined);
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
					const settledPresentation = planPresentationForToolCall(messagesRef.current, toolCallId);
					if (settledPresentation && sessionMetadataRef.current.sessionId) {
						await client
							.upsertPlanPresentation({
								sessionId: sessionMetadataRef.current.sessionId,
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
						setMessagesSynced((current) =>
							current.map((message) => {
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
						);
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
				sessionId: sessionMetadataRef.current.sessionId,
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
		[client, setMessagesSynced],
	);

	const enhanceMessages = useCallback(
		(currentMessages: Array<ChatMessage>) => enhancePlanDecisionMessages(currentMessages, submitQuestionAnswer),
		[submitQuestionAnswer],
	);

	useEffect(() => {
		sessionMetadataRef.current = sessionMetadata;
	}, [sessionMetadata]);

	useEffect(() => {
		statusRef.current = status;
	}, [status]);

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
		recoverFromForbiddenSession,
		refreshSessions,
		setActivityLabelSynced,
		setError,
		setMessagesSynced,
		setPlanLabelSynced,
		setPresentationSynced,
		setQueueSynced,
		setSessionMetadataSynced,
		setStatus,
	});

	const { resetStreamAdmission, sendMessage, setAdapterCapabilities } = usePiChatMessaging({
		activityLabelRef,
		client,
		messagesRef,
		presentationRef,
		model,
		pendingSendControllerRef,
		projectId,
		planLabelRef,
		queueRef,
		recoverFromForbiddenSession,
		refreshSessions,
		sessionMetadataRef,
		setActivityLabelSynced,
		setError,
		setMessagesSynced,
		setPresentationSynced,
		setPlanLabelSynced,
		setQueueSynced,
		setSessionMetadataSynced,
		setStatus,
		streamControllersRef,
		status,
	});

	const stop = useCallback(() => {
		const metadata = sessionMetadataRef.current;
		resetStreamAdmission(metadata.sessionId);
		pendingSendControllerRef.current?.abort();
		pendingSendControllerRef.current = null;
		if (metadata.sessionId) {
			void client.abortSession(metadata).catch(() => undefined);
		}
		if (metadata.sessionId) {
			streamControllersRef.current.get(metadata.sessionId)?.abort();
			streamControllersRef.current.delete(metadata.sessionId);
		}
		invalidateQueueMutations();
		setStatus("ready");
		setQueueSynced(EMPTY_QUEUE_STATE);
		setActivityLabelSynced(undefined);
	}, [client, invalidateQueueMutations, resetStreamAdmission, setActivityLabelSynced, setQueueSynced]);

	const mutateQueuedMessage = useCallback(
		(
			lane: ChatQueueMutationRequest["lane"],
			index: number,
			expectedText: string,
			mutation: ChatQueueMutationKind,
			options?: { staleMessage?: string },
		) => {
			const originatingSessionId = sessionMetadataRef.current.sessionId;
			const requestedRevision = queueRevisionRef.current;
			const requestedItems = lane === "steering" ? queueRef.current.steering : queueRef.current.followUp;
			const requestedMatchCount = requestedItems.filter((item) => item === expectedText).length;
			const previousMutation = queuedMutationTailRef.current ?? Promise.resolve();
			const queuedMutation = previousMutation
				.catch(() => undefined)
				.then(async () => {
					if (!originatingSessionId || sessionMetadataRef.current.sessionId !== originatingSessionId) return false;
					const refuseStaleMutation = (expectedRace: boolean) => {
						if (!expectedRace && options?.staleMessage) {
							notifyChatError(new Error(options.staleMessage));
						}
						return false;
					};
					const current = queueRef.current;
					const items = lane === "steering" ? current.steering : current.followUp;
					let resolvedIndex: number | undefined;
					if (queueRevisionRef.current === requestedRevision) {
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
						return refuseStaleMutation(queueRevisionRef.current !== requestedRevision);

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
					setQueueSynced(optimistic);
					const requestRevision = queueRevisionRef.current;

					try {
						const result = await client.mutateQueuedMessage({
							sessionId: originatingSessionId,
							lane,
							index: resolvedIndex,
							expectedText,
							mutation,
						});
						if (
							sessionMetadataRef.current.sessionId !== originatingSessionId ||
							queueRevisionRef.current !== requestRevision
						) {
							return result.status === "applied";
						}
						setQueueSynced(result.queue);
						return result.status === "applied";
					} catch (queueError) {
						if (
							sessionMetadataRef.current.sessionId === originatingSessionId &&
							queueRevisionRef.current === requestRevision &&
							queueRef.current === optimistic
						) {
							setQueueSynced(current);
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
		[client, setQueueSynced],
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

	const startNewSession = useCallback(
		async (options?: { projectId?: string; preserveRunning?: boolean }) => {
			if (options?.preserveRunning === false) stop();
			else {
				invalidateQueueMutations();
				setStatus("ready");
			}
			const result = await client.createSession(options?.projectId ?? projectIdRef.current ?? projectId);
			setSessionMetadataSynced(result.session);
			setMessagesSynced([]);
			setPresentationSynced(result.presentation);
			setQueueSynced(EMPTY_QUEUE_STATE);
			setActivityLabelSynced(undefined);
			setPlanLabelSynced(undefined);
			notify.success("New session started");
			await refreshSessions();
		},
		[
			client,
			refreshSessions,
			setActivityLabelSynced,
			setMessagesSynced,
			setPresentationSynced,
			setPlanLabelSynced,
			setQueueSynced,
			setSessionMetadataSynced,
			invalidateQueueMutations,
			stop,
			projectId,
		],
	);

	const resumeSession = useCallback(
		async (metadata: ChatSessionMetadata, options?: { preserveRunning?: boolean }) => {
			const requestId = resumeRequestRef.current + 1;
			resumeRequestRef.current = requestId;
			const isCurrent = () => resumeRequestRef.current === requestId;
			invalidateQueueMutations();
			try {
				if (options?.preserveRunning === false) stop();
				const result = await client.resumeSession(metadata);
				if (!isCurrent()) return false;
				setSessionMetadataSynced(result.session);
				setMessagesSynced(hydratePlanPresentationMessages(result.messages, result.planPresentations));
				setPresentationSynced(result.presentation);
				setQueueSynced(EMPTY_QUEUE_STATE);
				setActivityLabelSynced(result.sessionReset ? "Started a fresh Pi session" : undefined);
				setPlanLabelSynced(undefined);
				setStatus(streamControllersRef.current.has(result.session.sessionId ?? "") ? "streaming" : "ready");
				await refreshSessions();
				if (!isCurrent()) return false;
				return true;
			} catch (err) {
				// A newer resume may have selected a session while this request was
				// in flight. Do not let its recovery replace that newer selection.
				if (!isCurrent()) return false;
				const recoveryDeps = { setError, setStatus };
				// Recover into the project this resume targeted; mid-switch the
				// hook-level default may still point at the previous project.
				const recover = () => recoverFromForbiddenSession(metadata.projectId);
				const recovered =
					(await tryRecoverForbiddenSession(err, recover, recoveryDeps)) ||
					(await tryRecoverUnknownSession(err, recover, recoveryDeps));
				if (!isCurrent()) return false;
				if (recovered) {
					return false;
				}
				const nextError = err instanceof Error ? err : new Error(String(err));
				setError(nextError);
				setStatus("error");
				notifyChatError(nextError);
				return false;
			}
		},
		[
			client,
			recoverFromForbiddenSession,
			refreshSessions,
			setActivityLabelSynced,
			setMessagesSynced,
			setPresentationSynced,
			setPlanLabelSynced,
			setQueueSynced,
			setSessionMetadataSynced,
			invalidateQueueMutations,
			stop,
		],
	);

	const switchProject = useCallback(
		async (nextProjectId: string, nextSessionId?: string) => {
			if (nextSessionId) {
				return resumeSession({ sessionId: nextSessionId, projectId: nextProjectId }, { preserveRunning: true });
			}
			invalidateQueueMutations();
			setSessionMetadataSynced({ projectId: nextProjectId });
			setMessagesSynced([]);
			setPresentationSynced({ revision: 0, userBash: [], rlmChildren: [], refinements: [], artifactRuns: [] });
			setQueueSynced(EMPTY_QUEUE_STATE);
			setActivityLabelSynced(undefined);
			setPlanLabelSynced(undefined);
			setStatus("ready");
			return true;
		},
		[
			resumeSession,
			setActivityLabelSynced,
			setMessagesSynced,
			setPlanLabelSynced,
			setPresentationSynced,
			setQueueSynced,
			setSessionMetadataSynced,
			invalidateQueueMutations,
		],
	);

	useEffect(() => {
		sendMessageRef.current = sendMessage;
	}, [sendMessage]);

	usePiChatSessionEvents({
		client,
		presentationRef,
		sessionId: sessionMetadata.sessionId,
		sessionMetadataRef,
		setActivityLabelSynced,
		setAdapterCapabilities,
		setMessagesSynced,
		setPresentationSynced,
		setQueueSynced,
		setSessionMetadataSynced,
		statusRef,
	});

	const enhancedMessages = useMemo(() => enhanceMessages(messages), [messages, enhanceMessages]);
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
	const deleteSession = useCallback(
		async (sessionId: string): Promise<boolean> => {
			const deletingActive = sessionMetadataRef.current.sessionId === sessionId;
			if (deletingActive) stop();
			try {
				await client.deleteSession(sessionId);
			} catch (err) {
				notifyChatError(err);
				return false;
			}
			if (deletingActive) {
				setSessionMetadataSynced({});
				setMessagesSynced([]);
				setPresentationSynced({ revision: 0, userBash: [], rlmChildren: [], refinements: [], artifactRuns: [] });
			}
			await refreshSessions();
			return true;
		},
		[client, refreshSessions, setMessagesSynced, setPresentationSynced, setSessionMetadataSynced, stop],
	);

	const answerQuestion = submitQuestionAnswer;

	const getSessionMetadata = useCallback(() => sessionMetadataRef.current, []);
	const getMessages = useCallback(() => messagesRef.current, []);

	return {
		activityLabel,
		answerQuestion,
		appendLocalMessage,
		deleteQueuedMessage,
		editQueuedMessage,
		deleteSession,
		error,
		getMessages,
		getSessionMetadata,
		messages: enhancedMessages,
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
