import { Bot, ChevronRight } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  ChatSessionResponse,
  PrimeAgentRlmChild,
  PrimeAgentRlmTree,
} from "@prime-agent/web-protocol/chat-protocol"
import { Button } from "../../../ui/button"
import { cn } from "../../../../lib/utils"
import { orderedRlmChildren, rlmStatusIcon } from "../../../../lib/pi/subagent-utils"
import {
  SubagentTranscriptView,
  type SubagentTranscriptState,
} from "./subagent-transcript"

type SubagentsPanelContentProps = {
  agents: Array<PrimeAgentRlmChild>
  loadSession: (parentSessionId: string, childId: string) => Promise<ChatSessionResponse>
  onOpenTab?: (childId: string) => void
  parentSessionId?: string
  tree?: PrimeAgentRlmTree
}

type TranscriptState = SubagentTranscriptState & {
  requestKey: string
}

/**
 * Displays delegated subagent threads and the selected child's transcript.
 * The transcript surface is shared with the full-width agent tab so both
 * entry points render the same messages, tools, artifacts, and nested agents.
 */
export function SubagentsPanelContent({
  agents,
  loadSession,
  onOpenTab,
  parentSessionId,
  tree,
}: SubagentsPanelContentProps) {
  const ordered = useMemo(() => orderedRlmChildren(agents, tree), [agents, tree])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptState>>({})
  const requestVersions = useRef(new Map<string, number>())
  const selectedAgent = ordered.find((agent) => agent.id === selectedAgentId) ?? ordered[0]

  useEffect(() => {
    if (selectedAgentId && ordered.some((agent) => agent.id === selectedAgentId)) return
    setSelectedAgentId(ordered[0]?.id ?? null)
  }, [ordered, selectedAgentId])

  const loadTranscript = useCallback(
    async (agent: PrimeAgentRlmChild, force = false) => {
      if (!parentSessionId) return
      const requestKey = `${parentSessionId}:${agent.id}:${agent.status}:${agent.timestamp}:${agent.activeSessionId ?? ""}`
      const current = transcripts[agent.id]
      if (!force && current?.requestKey === requestKey) return

      const version = (requestVersions.current.get(agent.id) ?? 0) + 1
      requestVersions.current.set(agent.id, version)
      setTranscripts((previous) => ({
        ...previous,
        [agent.id]: { requestKey, status: "loading", messages: [] },
      }))

      try {
        const response = await loadSession(parentSessionId, agent.id)
        if (requestVersions.current.get(agent.id) !== version) return
        setTranscripts((previous) => ({
          ...previous,
          [agent.id]: {
            requestKey,
            status: "ready",
            messages: response.messages,
            presentation: response.presentation,
          },
        }))
      } catch (error) {
        if (requestVersions.current.get(agent.id) !== version) return
        setTranscripts((previous) => ({
          ...previous,
          [agent.id]: {
            requestKey,
            status: "error",
            messages: [],
            error: error instanceof Error ? error : new Error(String(error)),
          },
        }))
      }
    },
    [loadSession, parentSessionId, transcripts],
  )

  useEffect(() => {
    if (selectedAgent) void loadTranscript(selectedAgent)
  }, [loadTranscript, selectedAgent])

  if (ordered.length === 0) {
    return (
      <section
        aria-label="Subagents"
        className="flex min-h-36 items-center rounded-md border border-dashed border-border/70 px-4 text-center text-[12px] leading-5 text-foreground/45"
      >
        Subagent threads will appear here when Prime delegates work.
      </section>
    )
  }

  return (
    <section aria-label="Subagents" className="space-y-2 pb-1">
      <div className="flex min-w-0 items-center gap-2 rounded-sm bg-foreground/5 px-2 py-1.5">
        <Bot className="size-3.5 shrink-0 text-foreground/45" />
        <span className="min-w-0 flex-1 truncate text-label font-medium text-foreground/70">Invoked subagents</span>
        <span className="shrink-0 text-[10px] text-foreground/40">{ordered.length}</span>
      </div>

      <div className="space-y-0.5" data-testid="subagent-thread-list">
        {ordered.map((agent) => {
          const selected = agent.id === selectedAgent?.id
          return (
            <Button
              key={agent.id}
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={selected}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected && "bg-foreground/8",
              )}
              style={{ paddingLeft: `${8 + Math.max(0, agent.depth ?? 0) * 12}px` }}
              onClick={() => {
                setSelectedAgentId(agent.id)
                onOpenTab?.(agent.id)
              }}
            >
              <span className="shrink-0">{rlmStatusIcon(agent.status)}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">{agent.label}</span>
              <ChevronRight className="size-3 shrink-0 text-foreground/30" />
              <span className="shrink-0 text-[10px] capitalize text-foreground/45">{agent.status}</span>
            </Button>
          )
        })}
      </div>

      {selectedAgent ? (
        <SubagentTranscriptView
          child={selectedAgent}
          parentSessionId={parentSessionId}
          transcript={transcripts[selectedAgent.id]}
          onRefresh={() => void loadTranscript(selectedAgent, true)}
        />
      ) : null}
    </section>
  )
}
