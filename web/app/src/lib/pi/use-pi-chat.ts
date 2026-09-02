import { notify } from "@prime-agent/web-design/lib/notify";
import type {
	ChatMode,
	ChatModelSelection,
	ChatOpenUIArtifactUpsertRequest,
	ChatPlanAction,
	ChatQuestionAnswer,
	ChatQueueMutationRequest,
	ChatSessionInfo,
	ChatSessionMetadata,
	ChatStreamEvent,
	FleetAdapterCapabilities,
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
import { upsertAssistantReasoningPresentation } from "./chat-message-helpers";
import { resolveChatApiUrl } from "./chat-runtime-url";
import { EMPTY_QUEUE_STATE, normalizeSessionMetadata } from "./chat-stream-state";
import { hydratePlanPresentationMessages, planPresentationForToolCall } from "./plan-presentation";
import { isPlanDecisionToolCall } from "./plan-state";
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
	const messagesRef = useRef(messages);
	const sessionMetadataRef = useRef(sessionMetadata);
	const activityLabelRef = useRef(activityLabel);
	const planLabelRef = useRef(planLabel);
	const queueRef = useRef(queue);
	const queueRevisionRef = useRef(0);
	const queuedDeletionTailRef = useRef(Promise.resolve());
	const presentationRef = useRef(presentation);
	const pendingSendControllerRef = useRef<AbortController | null>(null);
	const streamControllersRef = useRef(new Map<string, AbortController>());
	const statusRef = useRef(status);
	const initializedRef = useRef(false);
	const sendMessageRef = useRef<(input: SendMessageInput) => Promise<void>>(() => Promise.resolve());
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

	const refreshSessions = useCallback(async () => {
		const nextSessions = await client.listSessions();
		setSessions(nextSessions);
		return nextSessions;
	}, [client]);

	const recoverFromForbiddenSession = useCallback(
		// An override recovers into the project the caller asked to resume,
		// instead of the hook-level default captured at mount.
		(projectIdOverride?: ProjectId | null) =>
			runForbiddenSessionRecovery({
				client,
				projectId: projectIdOverride ?? projectId,
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
			projectId,
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

	useEffect(() => {
		let cancelled = false;
		void refreshSessions().catch((err) => {
			if (cancelled) return;
			const nextError = err instanceof Error ? err : new Error(String(err));
			setError(nextError);
			notifyChatError(nextError);
		});
		return () => {
			cancelled = true;
		};
	}, [refreshSessions]);

	useEffect(() => {
		if (initializedRef.current) return;
		initializedRef.current = true;
		const controller = new AbortController();
		setStatus("ready");
		setError(null);
		setQueueSynced(EMPTY_QUEUE_STATE);
		setActivityLabelSynced(undefined);
		setPlanLabelSynced(undefined);
		setMessagesSynced([]);

		const storedSession = initialSessionMetadataRef.current;
		void refreshSessions()
			.then((availableSessions) => {
				if (controller.signal.aborted) return undefined;
				const selected = storedSession.sessionId
					? availableSessions.find((candidate) => candidate.sessionId === storedSession.sessionId)
					: undefined;
				const fallback =
					selected ??
					(storedSession.projectId
						? availableSessions.find((candidate) => candidate.projectId === storedSession.projectId)
						: availableSessions[0]);
				if (!fallback) {
					setSessionMetadataSynced(storedSession.projectId ? { projectId: storedSession.projectId } : {});
					return undefined;
				}
				const metadata = selected
					? storedSession
					: { sessionId: fallback.sessionId, projectId: fallback.projectId };
				return client.loadSession(metadata);
			})
			.then((result) => {
				if (!result || controller.signal.aborted) return;
				setSessionMetadataSynced(result.session);
				setMessagesSynced(hydratePlanPresentationMessages(result.messages, result.planPresentations));
				setPresentationSynced(result.presentation);
				setActivityLabelSynced(result.sessionReset ? "Started a fresh Pi session" : undefined);
			})
			.catch(async (err) => {
				if (controller.signal.aborted) return;
				const recoveryDeps = { setError, setStatus };
				const recovered =
					(await tryRecoverForbiddenSession(err, recoverFromForbiddenSession, recoveryDeps)) ||
					(await tryRecoverUnknownSession(err, recoverFromForbiddenSession, recoveryDeps));
				if (recovered || controller.signal.aborted) return;
				const nextError = err instanceof Error ? err : new Error(String(err));
				setError(nextError);
				setStatus("error");
				notifyChatError(nextError);
			});

		return () => {
			controller.abort();
		};
	}, [
		client,
		setActivityLabelSynced,
		setMessagesSynced,
		setPlanLabelSynced,
		setPresentationSynced,
		setQueueSynced,
		setSessionMetadataSynced,
		refreshSessions,
		recoverFromForbiddenSession,
	]);

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

	const deleteQueuedMessage = useCallback(
		(lane: ChatQueueMutationRequest["lane"], index: number, expectedText: string) => {
			const originatingSessionId = sessionMetadataRef.current.sessionId;
			const requestedRevision = queueRevisionRef.current;
			const requestedItems = lane === "steering" ? queueRef.current.steering : queueRef.current.followUp;
			const requestedMatchCount = requestedItems.filter((item) => item === expectedText).length;
			const previousDeletion = queuedDeletionTailRef.current;
			const deletion = previousDeletion
				.catch(() => undefined)
				.then(async () => {
					if (!originatingSessionId || sessionMetadataRef.current.sessionId !== originatingSessionId) return false;
					const current = queueRef.current;
					const items = lane === "steering" ? current.steering : current.followUp;
					let resolvedIndex: number | undefined;
					if (queueRevisionRef.current === requestedRevision) {
						resolvedIndex = items[index] === expectedText ? index : undefined;
					} else {
						if (requestedMatchCount !== 1) return false;
						// Queue snapshots expose text only, so a unique match in both snapshots
						// is the only safe way to resolve an item after a revision.
						const currentMatches = items.reduce<Array<number>>((matches, item, itemIndex) => {
							if (item === expectedText) matches.push(itemIndex);
							return matches;
						}, []);
						resolvedIndex = currentMatches.length === 1 ? currentMatches[0] : undefined;
					}
					if (resolvedIndex === undefined) return false;

					const optimistic = {
						...current,
						[lane]: items.filter((_, itemIndex) => itemIndex !== resolvedIndex),
					};
					setQueueSynced(optimistic);
					const requestRevision = queueRevisionRef.current;

					try {
						const result = await client.deleteQueuedMessage({
							sessionId: originatingSessionId,
							lane,
							index: resolvedIndex,
							expectedText,
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
			queuedDeletionTailRef.current = deletion.then(
				() => undefined,
				() => undefined,
			);
			return deletion;
		},
		[client, setQueueSynced],
	);

	const startNewSession = useCallback(
		async (options?: { projectId?: string; preserveRunning?: boolean }) => {
			if (options?.preserveRunning === false) stop();
			else {
				invalidateQueueMutations();
				setStatus("ready");
			}
			const result = await client.createSession(options?.projectId ?? projectId);
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
			invalidateQueueMutations();
			try {
				if (options?.preserveRunning === false) stop();
				const result = await client.resumeSession(metadata);
				setSessionMetadataSynced(result.session);
				setMessagesSynced(hydratePlanPresentationMessages(result.messages, result.planPresentations));
				setPresentationSynced(result.presentation);
				setQueueSynced(EMPTY_QUEUE_STATE);
				setActivityLabelSynced(result.sessionReset ? "Started a fresh Pi session" : undefined);
				setPlanLabelSynced(undefined);
				setStatus(streamControllersRef.current.has(result.session.sessionId ?? "") ? "streaming" : "ready");
				await refreshSessions();
				return true;
			} catch (err) {
				const recoveryDeps = { setError, setStatus };
				// Recover into the project this resume targeted; mid-switch the
				// hook-level default may still point at the previous project.
				const recover = () => recoverFromForbiddenSession(metadata.projectId);
				const recovered =
					(await tryRecoverForbiddenSession(err, recover, recoveryDeps)) ||
					(await tryRecoverUnknownSession(err, recover, recoveryDeps));
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

	// Per-visible-session EventSource with Last-Event-ID resumption. The
	// NDJSON stream in `use-pi-chat-messaging` is authoritative for in-flight
	// turns; this source carries server-side pushes (dialog requests, notify)
	// that arrive outside a turn.
	useEffect(() => {
		const sessionId = sessionMetadata.sessionId;
		if (!sessionId || typeof window === "undefined") return;

		const lastEventIdKey = `pi:sse:last-event-id:${sessionId}`;
		const sseCapabilitiesRef = { current: undefined as FleetAdapterCapabilities | undefined };
		let lastEventId = Number.parseInt(window.sessionStorage.getItem(lastEventIdKey) ?? "0", 10);
		if (Number.isNaN(lastEventId)) lastEventId = 0;

		let source: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let closedByEffect = false;

		const handleEvent = (raw: MessageEvent<string>) => {
			let frame: ChatStreamEvent;
			try {
				frame = JSON.parse(raw.data) as ChatStreamEvent;
			} catch {
				return;
			}
			if (frame.type === "presentation") {
				if (frame.presentation.revision > (presentationRef.current?.revision ?? -1)) {
					setPresentationSynced(frame.presentation);
				}
				return;
			}
			// In-flight NDJSON stream is authoritative; only act on out-of-turn pushes.
			const currentStatus = statusRef.current;
			if (currentStatus === "streaming" || currentStatus === "submitted") return;
			const connected = frame as unknown as {
				type?: string;
				adapterCapabilities?: FleetAdapterCapabilities;
			};
			if (connected.type === "connected") {
				const caps = connected.adapterCapabilities;
				sseCapabilitiesRef.current = caps;
				setAdapterCapabilities(caps);
				return;
			}
			if (frame.type === "reasoning") {
				const capabilities = sseCapabilitiesRef.current;
				const messageId = frame.messageId;
				if (!capabilities?.features.includes("reasoning-summary-v1") || !messageId) return;
				setMessagesSynced((current) =>
					upsertAssistantReasoningPresentation(current, messageId, frame.presentation),
				);
				return;
			}
			if (frame.type === "tool" && frame.part?.type === "tool-Question") {
				setMessagesSynced((current) => {
					const toolCallId = frame.part.toolCallId ?? "";
					const existingToolCallIndex = current.findIndex((message) =>
						message.parts.some(
							(p) => p.type !== "text" && p.type !== "error" && "toolCallId" in p && p.toolCallId === toolCallId,
						),
					);
					if (existingToolCallIndex !== -1) return current;
					const questionPart: ChatMessage["parts"][number] = {
						...frame.part,
						type: "tool-Question",
					};
					return [
						...current,
						{
							id: crypto.randomUUID(),
							role: "assistant",
							parts: [questionPart],
							createdAt: new Date().toISOString(),
						},
					];
				});
				return;
			}
			if (frame.type === "state") {
				setActivityLabelSynced(typeof frame.state?.message === "string" ? frame.state.message : undefined);
				if (frame.state?.name === "agent_settled") {
					// Server asked us to resync — refetch the session transcript and
					// rebuild the UI state without spinning up a new turn.
					const settledSessionId = sessionId;
					void client
						.loadSession({ sessionId: settledSessionId })
						.then((result) => {
							if (sessionMetadataRef.current.sessionId !== settledSessionId) return;
							setMessagesSynced(hydratePlanPresentationMessages(result.messages, result.planPresentations));
							setPresentationSynced(result.presentation);
							setSessionMetadataSynced(result.session);
							setQueueSynced(EMPTY_QUEUE_STATE);
						})
						.catch(() => undefined);
				}
				return;
			}
			if (frame.type === "queue") {
				setQueueSynced({ steering: frame.steering, followUp: frame.followUp });
				return;
			}
		};

		const connect = () => {
			const params = new URLSearchParams({ sessionId });
			if (lastEventId > 0) {
				// EventSource only sends Last-Event-ID on native reconnect of the same
				// instance. Closing it (below) starts a new connection, so pass the
				// stored cursor as a query param the server also accepts.
				params.set("lastEventId", String(lastEventId));
			}
			const url = resolveChatApiUrl(`/api/chat/events?${params}`);
			source?.close();
			source = new EventSource(url);
			source.onmessage = (event) => {
				const seq = Number.parseInt(event.lastEventId ?? "", 10);
				if (!Number.isNaN(seq) && seq > 0) {
					lastEventId = seq;
					window.sessionStorage.setItem(lastEventIdKey, String(seq));
				}
				handleEvent(event);
			};
			source.onerror = () => {
				source?.close();
				if (closedByEffect) return;
				// Exponential-ish backoff, capped. EventSource does its own reconnect,
				// but a manual retry makes timing deterministic for the dialog flow.
				if (reconnectTimer) clearTimeout(reconnectTimer);
				reconnectTimer = setTimeout(connect, 2_000);
			};
		};
		connect();

		return () => {
			closedByEffect = true;
			source?.close();
			if (reconnectTimer) clearTimeout(reconnectTimer);
		};
	}, [
		client,
		sessionMetadata.sessionId,
		setActivityLabelSynced,
		setMessagesSynced,
		setQueueSynced,
		setPresentationSynced,
		setSessionMetadataSynced,
		setAdapterCapabilities,
	]);

	const enhancedMessages = useMemo(() => enhanceMessages(messages), [messages, enhanceMessages]);
	const renameSession = useCallback(
		async (sessionId: string, title: string) => {
			await client.renameSession(sessionId, title);
			await refreshSessions();
		},
		[client, refreshSessions],
	);
	const deleteSession = useCallback(
		async (sessionId: string) => {
			const deletingActive = sessionMetadataRef.current.sessionId === sessionId;
			if (deletingActive) stop();
			await client.deleteSession(sessionId);
			if (deletingActive) {
				setSessionMetadataSynced({});
				setMessagesSynced([]);
				setPresentationSynced({ revision: 0, userBash: [], rlmChildren: [], refinements: [], artifactRuns: [] });
			}
			await refreshSessions();
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
