import { createContext, useContext, useMemo } from "react"
import { AgentChat } from "../../agent-elements/agent-chat"
import { cn } from "../../../lib/utils"
import { GenerativeTextRenderer } from "../../openui/inline-renderer"
import { PI_TOOL_RENDERERS } from "../pi/tool-renderers"
import { FleetPiToolRenderer } from "./fleet-pi-tool-renderer"
import {
  FleetPiInputBar,
  withFleetPiSuggestionStyles,
} from "./fleet-pi-input-bar"
import type { AgentChatProps } from "../../agent-elements/types"
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type { FleetPiInputBarProps } from "./fleet-pi-input-bar"
import type { InputBarProps } from "../../agent-elements/input-bar"

export type FleetPiAgentChatProps = Omit<
  AgentChatProps,
  "slots" | "toolRenderers" | "style" | "suggestions"
> & {
  toolRenderers?: AgentChatProps["toolRenderers"]
  suggestions?: AgentChatProps["suggestions"]
  className?: string
  inputBar: Omit<
    FleetPiInputBarProps,
    "onSend" | "onStop" | "status" | "suggestions"
  >
}

const InputBarPropsContext = createContext<{
  inputBar: FleetPiAgentChatProps["inputBar"]
  status: ChatStatus
  onStop: () => void
} | null>(null)

function StableInputBarSlot(props: InputBarProps) {
  const ctx = useContext(InputBarPropsContext)
  if (!ctx) return null

  // `controlled` and `attachments` are grouped objects — a JSX spread of the
  // ctx value would clobber the slot's own object even when ctx leaves them
  // undefined, so merge them field-wise instead of spreading.
  const { inputBar, status, onStop } = ctx

  return (
    <FleetPiInputBar
      {...props}
      {...inputBar}
      controlled={inputBar.controlled ?? props.controlled}
      attachments={inputBar.attachments ?? props.attachments}
      status={status}
      onStop={onStop}
    />
  )
}

const fleetPiAgentChatSlots = {
  TextRenderer: GenerativeTextRenderer,
  InputBar: StableInputBarSlot,
  ToolRenderer: FleetPiToolRenderer,
}

export function FleetPiAgentChat({
  toolRenderers = PI_TOOL_RENDERERS,
  suggestions,
  status,
  onStop,
  inputBar,
  className,
  ...agentChatProps
}: FleetPiAgentChatProps) {
  const styledSuggestions = withFleetPiSuggestionStyles(suggestions)

  const contextValue = useMemo(
    () => ({ inputBar, status, onStop }),
    [inputBar, onStop, status]
  )

  return (
    <InputBarPropsContext.Provider value={contextValue}>
      <AgentChat
        {...agentChatProps}
        className={cn("fleet-pi-agent-chat", className)}
        status={status}
        onStop={onStop}
        suggestions={styledSuggestions}
        toolRenderers={toolRenderers}
        slots={fleetPiAgentChatSlots}
      />
    </InputBarPropsContext.Provider>
  )
}
