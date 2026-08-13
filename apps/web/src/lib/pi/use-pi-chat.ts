import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { chatClient } from "./chat-client"
import { isPlanDecisionToolCall } from "./plan-state"
import { EMPTY_QUEUE_STATE } from "./chat-stream-state"
import {
  runForbiddenSessionRecovery,
  tryRecoverForbiddenSession,
} from "./use-pi-chat-forbidden-session"
import { usePiChatMessaging } from "./use-pi-chat-messaging"
import {
  enhancePlanDecisionMessages,
  resolvePlanDecisionMessages,
} from "./use-pi-chat-plan-decisions"
import { resolveChatApiUrl } from "./chat-runtime-url"
import type { QueueState } from "./chat-fetch"
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type {
  ChatModelSelection,
  ChatPlanAction,
  ChatQuestionAnswer,
  ChatSessionInfo,
  ChatSessionMetadata,
  ChatStreamEvent,
} from "@prime-agent/web-protocol/chat-protocol"
import type { ChatClient } from "./chat-client"

export type SendMessageInput = {
  text: string
  planAction?: ChatPlanAction
  /** Mirror of the Alt/Option modifier at Enter-press time. */
  altKey?: boolean
}

export type UsePiChatOptions = {
  client?: ChatClient
  initialSessionMetadata: ChatSessionMetadata
  persistSession: (metadata: ChatSessionMetadata) => void
}

export function usePiChat(
  model: ChatModelSelection | undefined,
  options: UsePiChatOptions
) {
  const { client = chatClient, initialSessionMetadata, persistSession } =
    options
  const [messages, setMessages] = useState<Array<ChatMessage>>([])
  const [status, setStatus] = useState<ChatStatus>("ready")
  const [error, setError] = useState<Error | null>(null)
  const [sessionMetadata, setSessionMetadata] = useState<ChatSessionMetadata>(
    () => initialSessionMetadata
  )
  const [sessions, setSessions] = useState<Array<ChatSessionInfo>>([])
  const [activityLabel, setActivityLabel] = useState<string | undefined>()
  const [planLabel, setPlanLabel] = useState<string | undefined>()
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE_STATE)
  const initialSessionMetadataRef = useRef(initialSessionMetadata)
  const messagesRef = useRef(messages)
  const sessionMetadataRef = useRef(sessionMetadata)
  const activityLabelRef = useRef(activityLabel)
  const planLabelRef = useRef(planLabel)
  const queueRef = useRef(queue)
  const abortRef = useRef<AbortController | null>(null)
  const sendMessageRef = useRef<(input: SendMessageInput) => Promise<void>>(
    () => Promise.resolve()
  )
  const setMessagesSynced = useCallback(
    (
      updater:
        | Array<ChatMessage>
        | ((current: Array<ChatMessage>) => Array<ChatMessage>)
    ) => {
      const next =
        typeof updater === "function" ? updater(messagesRef.current) : updater
      messagesRef.current = next
      setMessages(next)
    },
    []
  )

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
          createdAt: Date.now(),
          parts: [{ type: "text" as const, text }],
        },
      ])
    },
    [setMessagesSynced]
  )

  const setSessionMetadataSynced = useCallback(
    (metadata: ChatSessionMetadata) => {
      if (
        sessionMetadataRef.current.sessionFile === metadata.sessionFile &&
        sessionMetadataRef.current.sessionId === metadata.sessionId
      ) {
        return
      }

      sessionMetadataRef.current = metadata
      setSessionMetadata(metadata)
      persistSession(metadata)
    },
    [persistSession]
  )

  const setActivityLabelSynced = useCallback(
    (nextLabel: string | undefined) => {
      activityLabelRef.current = nextLabel
      setActivityLabel(nextLabel)
    },
    []
  )

  const setPlanLabelSynced = useCallback((nextLabel: string | undefined) => {
    planLabelRef.current = nextLabel
    setPlanLabel(nextLabel)
  }, [])

  const setQueueSynced = useCallback((nextQueue: QueueState) => {
    queueRef.current = nextQueue
    setQueue(nextQueue)
  }, [])

  const refreshSessions = useCallback(async () => {
    const nextSessions = await client.listSessions()
    setSessions(nextSessions)
  }, [client])

  const recoverFromForbiddenSession = useCallback(
    () =>
      runForbiddenSessionRecovery({
        client,
        refreshSessions,
        setActivityLabelSynced,
        setError,
        setMessagesSynced,
        setPlanLabelSynced,
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
      setQueueSynced,
      setSessionMetadataSynced,
    ]
  )

  const submitQuestionAnswer = useCallback(
    async ({
      toolCallId,
      answer,
    }: {
      toolCallId?: string
      answer: ChatQuestionAnswer
    }) => {
      const result = await client.answerQuestion({
        sessionFile: sessionMetadataRef.current.sessionFile,
        sessionId: sessionMetadataRef.current.sessionId,
        toolCallId,
        answer,
      })

      if (result.ok && isPlanDecisionToolCall(toolCallId)) {
        setMessagesSynced((current) =>
          resolvePlanDecisionMessages(current, toolCallId, answer)
        )
      }
      if (result.message) {
        await sendMessageRef.current({
          text: result.message,
          planAction: result.planAction,
        })
      }

      return result
    },
    [client]
  )

  const enhanceMessages = useCallback(
    (currentMessages: Array<ChatMessage>) =>
      enhancePlanDecisionMessages(currentMessages, submitQuestionAnswer),
    [submitQuestionAnswer]
  )

  useEffect(() => {
    sessionMetadataRef.current = sessionMetadata
  }, [sessionMetadata])

  useEffect(() => {
    initialSessionMetadataRef.current = initialSessionMetadata
  }, [initialSessionMetadata])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    let cancelled = false
    void refreshSessions().catch((err) => {
      if (cancelled) return
      const nextError = err instanceof Error ? err : new Error(String(err))
      setError(nextError)
      toast.error(nextError.message)
    })
    return () => {
      cancelled = true
    }
  }, [refreshSessions])

  useEffect(() => {
    let cancelled = false
    const loadActiveSession = async () => {
      abortRef.current?.abort()
      abortRef.current = null
      setStatus("ready")
      setError(null)
      setQueueSynced(EMPTY_QUEUE_STATE)
      setActivityLabelSynced(undefined)
      setPlanLabelSynced(undefined)
      setMessagesSynced([])

      const storedSession = initialSessionMetadataRef.current
      const hasStoredSession =
        storedSession.sessionFile || storedSession.sessionId
      if (!hasStoredSession) {
        setSessionMetadataSynced({})
        return
      }

      const result = await client.loadSession(storedSession)
      if (cancelled) return
      setSessionMetadataSynced(result.session)
      setMessagesSynced(result.messages)
      setActivityLabelSynced(
        result.sessionReset ? "Started a fresh Pi session" : undefined
      )
    }

    void loadActiveSession().catch(async (err) => {
      if (cancelled) return
      if (
        await tryRecoverForbiddenSession(err, recoverFromForbiddenSession, {
          setError,
          setStatus,
        })
      ) {
        return
      }

      const nextError = err instanceof Error ? err : new Error(String(err))
      setError(nextError)
      setStatus("error")
      toast.error(nextError.message)
    })

    return () => {
      cancelled = true
    }
  }, [
    client,
    setActivityLabelSynced,
    setMessagesSynced,
    setPlanLabelSynced,
    setQueueSynced,
    setSessionMetadataSynced,
    recoverFromForbiddenSession,
  ])

  const { sendMessage } = usePiChatMessaging({
    abortRef,
    activityLabelRef,
    client,
    messagesRef,
    model,
    planLabelRef,
    queueRef,
    recoverFromForbiddenSession,
    refreshSessions,
    sessionMetadataRef,
    setActivityLabelSynced,
    setError,
    setMessagesSynced,
    setPlanLabelSynced,
    setQueueSynced,
    setSessionMetadataSynced,
    setStatus,
    status,
  })

  const stop = useCallback(() => {
    void client.abortSession(sessionMetadataRef.current).catch(() => undefined)
    abortRef.current?.abort()
    abortRef.current = null
    setStatus("ready")
    setQueueSynced(EMPTY_QUEUE_STATE)
    setActivityLabelSynced(undefined)
  }, [client, setActivityLabelSynced, setQueueSynced])

  const startNewSession = useCallback(async () => {
    const result = await client.createSession()
    setSessionMetadataSynced(result.session)
    setMessagesSynced([])
    setQueueSynced(EMPTY_QUEUE_STATE)
    setActivityLabelSynced(undefined)
    setPlanLabelSynced(undefined)
    toast.success("New session started")
    await refreshSessions()
  }, [
    client,
    refreshSessions,
    setActivityLabelSynced,
    setMessagesSynced,
    setPlanLabelSynced,
    setQueueSynced,
    setSessionMetadataSynced,
  ])

  const resumeSession = useCallback(
    async (metadata: ChatSessionMetadata) => {
      try {
        const result = await client.resumeSession(metadata)
        setSessionMetadataSynced(result.session)
        setMessagesSynced(result.messages)
        setQueueSynced(EMPTY_QUEUE_STATE)
        setActivityLabelSynced(
          result.sessionReset ? "Started a fresh Pi session" : undefined
        )
        setPlanLabelSynced(undefined)
        toast.success("Session resumed")
        await refreshSessions()
      } catch (err) {
        if (
          await tryRecoverForbiddenSession(err, recoverFromForbiddenSession, {
            setError,
            setStatus,
          })
        ) {
          return
        }
        const nextError = err instanceof Error ? err : new Error(String(err))
        setError(nextError)
        setStatus("error")
        toast.error(nextError.message)
      }
    },
    [
      client,
      recoverFromForbiddenSession,
      refreshSessions,
      setActivityLabelSynced,
      setMessagesSynced,
      setPlanLabelSynced,
      setQueueSynced,
      setSessionMetadataSynced,
    ]
  )

  useEffect(() => {
    sendMessageRef.current = sendMessage
  }, [sendMessage])

  // Per-visible-session EventSource with Last-Event-ID resumption. The
  // NDJSON stream in `use-pi-chat-messaging` is authoritative for in-flight
  // turns; this source carries server-side pushes (dialog requests, notify)
  // that arrive outside a turn.
  useEffect(() => {
    const sessionId = sessionMetadata.sessionId
    if (!sessionId || typeof window === "undefined") return

    const lastEventIdKey = `pi:sse:last-event-id:${sessionId}`
    let lastEventId = Number.parseInt(
      window.sessionStorage.getItem(lastEventIdKey) ?? "0",
      10
    )
    if (Number.isNaN(lastEventId)) lastEventId = 0

    let source: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let closedByEffect = false

    const handleEvent = (raw: MessageEvent<string>) => {
      let frame: ChatStreamEvent
      try {
        frame = JSON.parse(raw.data) as ChatStreamEvent
      } catch {
        return
      }
      // In-flight NDJSON stream is authoritative; only act on out-of-turn pushes.
      const currentStatus = status
      if (currentStatus === "streaming" || currentStatus === "submitted") return
      if (frame.type === "tool" && frame.part?.type === "tool-Question") {
        setMessagesSynced((current) => {
          const toolCallId = frame.part.toolCallId ?? ""
          const existingToolCallIndex = current.findIndex((message) =>
            message.parts.some(
              (p) =>
                p.type !== "text" &&
                p.type !== "error" &&
                "toolCallId" in p &&
                p.toolCallId === toolCallId
            )
          )
          if (existingToolCallIndex !== -1) return current
          const questionPart: ChatMessage["parts"][number] = {
            ...frame.part,
            type: "tool-Question",
          }
          return [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              parts: [questionPart],
              createdAt: new Date().toISOString(),
            },
          ]
        })
        return
      }
      if (frame.type === "state") {
        setActivityLabelSynced(
          typeof frame.state?.message === "string"
            ? frame.state.message
            : undefined
        )
        if (frame.state?.name === "agent_settled") {
          // Server asked us to resync — refetch the session transcript and
          // rebuild the UI state without spinning up a new turn.
          void client
            .loadSession({ sessionId })
            .then((result) => {
              setMessagesSynced(result.messages)
              setSessionMetadataSynced(result.session)
              setQueueSynced(EMPTY_QUEUE_STATE)
            })
            .catch(() => undefined)
        }
        return
      }
      if (frame.type === "queue") {
        setQueueSynced({ steering: frame.steering, followUp: frame.followUp })
        return
      }
    }

    const connect = () => {
      const params = new URLSearchParams({ sessionId })
      if (lastEventId > 0) {
        // EventSource only sends Last-Event-ID on native reconnect of the same
        // instance. Closing it (below) starts a new connection, so pass the
        // stored cursor as a query param the server also accepts.
        params.set("lastEventId", String(lastEventId))
      }
      const url = resolveChatApiUrl(`/api/chat/events?${params}`)
      source = new EventSource(url)
      source.onmessage = (event) => {
        const seq = Number.parseInt(event.lastEventId ?? "", 10)
        if (!Number.isNaN(seq) && seq > 0) {
          lastEventId = seq
          window.sessionStorage.setItem(lastEventIdKey, String(seq))
        }
        handleEvent(event)
      }
      source.onerror = () => {
        source?.close()
        if (closedByEffect) return
        // Exponential-ish backoff, capped. EventSource does its own reconnect,
        // but a manual retry makes timing deterministic for the dialog flow.
        reconnectTimer = setTimeout(connect, 2_000)
      }
    }
    connect()

    return () => {
      closedByEffect = true
      source?.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [
    client,
    sessionMetadata.sessionId,
    status,
    setActivityLabelSynced,
    setMessagesSynced,
    setQueueSynced,
    setSessionMetadataSynced,
  ])

  const enhancedMessages = useMemo(
    () => enhanceMessages(messages),
    [messages, enhanceMessages]
  )

  const answerQuestion = submitQuestionAnswer

  return {
    activityLabel,
    answerQuestion,
    appendLocalMessage,
    error,
    messages: enhancedMessages,
    planLabel,
    queue,
    refreshSessions,
    resumeSession,
    sendMessage,
    sessionMetadata,
    sessions,
    setError,
    startNewSession,
    status,
    stop,
  }
}
