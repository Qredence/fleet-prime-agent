import { Bot, Plus, X } from "lucide-react"
import { useCallback, useEffect, useRef, type KeyboardEvent } from "react"
import { Button } from "../../../ui/button"
import type { PrimeAgentRlmChild } from "@prime-agent/web-protocol/chat-protocol"
import { cn } from "../../../../lib/utils"

export type AgentTabItem = {
  id: string
  label: string
  kind: "main" | "subagent"
  status?: PrimeAgentRlmChild["status"]
}

/**
 * Creates a deterministic ARIA ID for an agent tab trigger.
 *
 * @param tabId - The tab identifier to encode
 * @returns The encoded tab trigger ID
 */
export function agentTabTriggerId(tabId: string) {
  return `agent-tab-${encodeURIComponent(tabId)}`
}

/**
 * Generates the ARIA ID for an agent tab panel.
 *
 * @param tabId - The tab identifier to encode in the panel ID
 * @returns The encoded agent tab panel ID
 */
export function agentTabPanelId(tabId: string) {
  return `agent-tab-panel-${encodeURIComponent(tabId)}`
}

/**
 * Maps an agent status to its accessible tab label.
 *
 * @param status - The agent status to label
 * @returns The corresponding label: `queued`, `streaming`, `error`, `cancelled`, `complete`, or `ready`
 */
function statusLabel(status: AgentTabItem["status"]): string {
  switch (status) {
    case "queued":
      return "queued"
    case "running":
    case "recovering":
      return "streaming"
    case "error":
    case "failed":
      return "error"
    case "cancelled":
      return "cancelled"
    case "done":
      return "complete"
    default:
      return "ready"
  }
}

/**
 * Determines the CSS classes for an agent status indicator.
 *
 * @param status - The agent status to represent
 * @returns CSS classes for the status indicator
 */
function statusDotClass(status: AgentTabItem["status"]): string {
  switch (status) {
    case "running":
    case "recovering":
      return "bg-emerald-400 motion-safe:animate-pulse"
    case "error":
    case "failed":
      return "bg-destructive"
    case "queued":
      return "bg-amber-300"
    case "cancelled":
      return "bg-foreground/35"
    default:
      return "bg-foreground/35"
  }
}

/**
 * Renders a tab bar for agent conversations with selection, keyboard navigation, and optional tab-closing and new-session controls.
 *
 * @param tabs - The agent conversation tabs to display
 * @param value - The ID of the selected tab
 * @param onValueChange - Called when a tab is selected
 * @param onClose - Called with a subagent tab ID when that tab is closed
 * @param onNewSession - Called when the new-chat control is selected
 */
export function AgentTabBar({
  tabs,
  value,
  onValueChange,
  onClose,
  onNewSession,
}: {
  tabs: Array<AgentTabItem>
  value: string
  onValueChange: (tabId: string) => void
  onClose?: (tabId: string) => void
  onNewSession?: () => void
}) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const setTabRef = useCallback((tabId: string, node: HTMLButtonElement | null) => {
    if (node) tabRefs.current.set(tabId, node)
    else tabRefs.current.delete(tabId)
  }, [])

  useEffect(() => {
    for (const tabId of tabRefs.current.keys()) {
      if (!tabs.some((tab) => tab.id === tabId)) tabRefs.current.delete(tabId)
    }
  }, [tabs])

  const focusTab = useCallback(
    (index: number) => {
      const tab = tabs[index]
      if (!tab) return
      tabRefs.current.get(tab.id)?.focus()
      onValueChange(tab.id)
    },
    [onValueChange, tabs],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, tabId: string) => {
      const index = tabs.findIndex((tab) => tab.id === tabId)
      if (index < 0) return
      let nextIndex: number | undefined
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length
      if (event.key === "Home") nextIndex = 0
      if (event.key === "End") nextIndex = tabs.length - 1
      if (nextIndex === undefined) return
      event.preventDefault()
      focusTab(nextIndex)
    },
    [focusTab, tabs],
  )

  return (
    <div
      className="flex min-w-0 max-w-full items-center gap-1"
      data-testid="agent-tab-bar"
    >
      <div
        aria-label="Agent conversations"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {tabs.map((tab) => {
          const active = tab.id === value
          const status = statusLabel(tab.status)
          return (
            <div
              key={tab.id}
              className="group/tab relative min-w-0 shrink-0 basis-[164px] sm:max-w-[164px]"
              data-tab-id={tab.id}
            >
              <Button
                ref={(node) => setTabRef(tab.id, node)}
                aria-controls={agentTabPanelId(tab.id)}
                aria-selected={active}
                aria-label={`${tab.label}, ${status}`}
                className={cn(
                  "h-7 w-full min-w-0 justify-start gap-1.5 rounded-[7px] border border-transparent px-2 text-[12px] font-medium leading-none transition-colors motion-reduce:transition-none",
                  active
                    ? "bg-[#2c2c2c] text-foreground shadow-none"
                    : "bg-transparent text-foreground/45 hover:bg-foreground/5 hover:text-foreground/75",
                  tab.kind === "subagent" && "pr-7",
                )}
                data-state={active ? "active" : "inactive"}
                id={agentTabTriggerId(tab.id)}
                onClick={() => onValueChange(tab.id)}
                onKeyDown={(event) => handleKeyDown(event, tab.id)}
                role="tab"
                size="sm"
                tabIndex={active ? 0 : -1}
                type="button"
                variant="ghost"
              >
                {tab.kind === "main" ? (
                  <Bot aria-hidden="true" className="size-3.5 shrink-0" />
                ) : (
                  <span
                    aria-hidden="true"
                    className={cn("size-1.5 shrink-0 rounded-full", statusDotClass(tab.status))}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{tab.label}</span>
              </Button>
              {tab.kind === "subagent" && onClose ? (
                <Button
                  aria-label={`Close ${tab.label} tab`}
                  className="absolute top-1/2 right-1 size-5 -translate-y-1/2 rounded-[5px] p-0 text-foreground/35 opacity-0 transition-opacity motion-reduce:transition-none hover:bg-foreground/10 hover:text-foreground/75 focus-visible:opacity-100 group-hover/tab:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation()
                    onClose(tab.id)
                  }}
                  size="icon-xs"
                  title={`Close ${tab.label} tab`}
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" className="size-3" />
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
      {onNewSession ? (
        <Button
          aria-label="New chat"
          className="size-7 shrink-0 rounded-[7px] text-foreground/50 hover:bg-foreground/7 hover:text-foreground/85"
          data-testid="new-chat-tab"
          onClick={onNewSession}
          size="icon-sm"
          title="New chat"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}
