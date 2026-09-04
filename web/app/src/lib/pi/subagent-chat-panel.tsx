import type { PrimeAgentRlmChild } from "@prime-agent/web-protocol/chat-protocol"
import { SubagentTranscriptView } from "@prime-agent/web-design/components/product/fleet-pi/pi/subagent-transcript"
import type { SubagentChatState } from "./use-subagent-chat"

/**
 * Renders the transcript view for a subagent chat.
 *
 * @param child - The subagent whose transcript is displayed
 * @param parentSessionId - Optional identifier of the parent session
 * @param state - The subagent chat state and refresh callback
 */
export function SubagentChatPanel({
  child,
  parentSessionId,
  state,
}: {
  child: PrimeAgentRlmChild
  parentSessionId?: string
  state: SubagentChatState & { refresh: () => void }
}) {
  const transcriptError =
    state.error ??
    (state.status === "error" ? new Error(child.error ?? "The subagent thread ended with an error.") : undefined)
  const transcriptStatus = state.loading
    ? "loading"
    : state.status === "error" || transcriptError
      ? "error"
      : "ready"

  return (
    <SubagentTranscriptView
      child={child}
      fullWidth
      parentSessionId={parentSessionId}
      status={state.status}
      transcript={{
        status: transcriptStatus,
        messages: state.messages,
        presentation: state.presentation,
        error: transcriptError,
      }}
      onRefresh={state.refresh}
    />
  )
}
