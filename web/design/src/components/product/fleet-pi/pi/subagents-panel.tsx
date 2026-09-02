import {
	AlertCircle,
	Bot,
	ChevronRight,
	RefreshCw,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type {
	ChatSessionResponse,
	PrimeAgentArtifact,
	PrimeAgentRlmChild,
	PrimeAgentRlmTree,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol"
import { Button } from "../../../ui/button"
import {
	Message,
	MessageBubble,
	MessageBubbleContent,
	MessageContent,
} from "../../../registry/beui/agents/message"
import { MessageScroller } from "../../../registry/beui/agents/message-scroller"
import { UserMessage } from "../../../registry/beui/agents/user-message"
import { buildAssistantElements } from "../../../registry/beui/agents/message-turns"
import { normalizeAssistantToolParts } from "../../../registry/beui/agents/utils/tool-part-normalizer"
import { PI_TOOL_RENDERERS } from "./tool-renderers"
import { FleetGenerativeTextRenderer } from "../chat/generative-text-renderer"
import { FleetPiToolRenderer } from "../chat/fleet-pi-tool-renderer"
import { derivePrimeAgentArtifactRuns } from "./prime-agent-artifacts"
import { FleetSubagentList } from "../../../registry/assistant-ui/elements/fleet-subagent-list"
import { FleetToolTimeline } from "../../../registry/assistant-ui/elements/fleet-tool-timeline"
import { cn } from "../../../../lib/utils"
import { groupMessages, type ConversationTurn } from "../../../../lib/pi/conversation-turns"
import { orderedRlmChildren, rlmStatusIcon } from "../../../../lib/pi/subagent-utils"

type SubagentsPanelContentProps = {
	agents: Array<PrimeAgentRlmChild>
	loadSession: (parentSessionId: string, childId: string) => Promise<ChatSessionResponse>
	parentSessionId?: string
	tree?: PrimeAgentRlmTree
}

type TranscriptState = {
	requestKey: string
	status: "loading" | "ready" | "error"
	messages: Array<ChatMessage>
	presentation?: PrimeAgentSessionPresentation
	error?: Error
}

/**
 * Maps a child agent's state to the corresponding chat status.
 *
 * @param child - The child agent whose status should be mapped
 * @returns `streaming` for running children, `error` for errored children, and `ready` for all other states
 */
function transcriptStatus(child: PrimeAgentRlmChild): ChatStatus {
	if (child.status === "running") return "streaming"
	if (child.status === "error") return "error"
	return "ready"
}

/**
 * Renders a conversation turn with its user message, assistant content, and final-turn metadata.
 *
 * @param turn - The conversation turn to display
 * @param isLast - Whether the turn is the most recent turn
 * @param isStreaming - Whether assistant content is still streaming
 * @param artifacts - Artifacts associated with the turn
 * @param presentation - Optional nested subagent presentation for the final turn
 * @returns The rendered conversation turn
 */
function SubagentTurnView({
	turn,
	isLast,
	isStreaming,
	artifacts,
	presentation,
}: {
	turn: ConversationTurn
	isLast: boolean
	isStreaming: boolean
	artifacts: Array<PrimeAgentArtifact>
	presentation?: PrimeAgentSessionPresentation
}) {
	const assistantElements = useMemo(
		() =>
			turn.assistants.flatMap((message, index) =>
				buildAssistantElements(normalizeAssistantToolParts(message.parts ?? []), {
					messageId: message.id,
					isLast: isLast && index === turn.assistants.length - 1,
					isStreaming,
					suppressQuestionTool: true,
					ToolRendererComponent: FleetPiToolRenderer,
					TextRendererComponent: FleetGenerativeTextRenderer,
					toolRenderers: PI_TOOL_RENDERERS,
				}),
			),
		[isLast, isStreaming, turn.assistants],
	)

	return (
		<div className="flex flex-col gap-3">
			{turn.user ? (
				<Message from="user">
					<MessageContent>
						<UserMessage message={turn.user} enableImagePreview={false} />
					</MessageContent>
				</Message>
			) : null}
			{turn.assistants.length > 0 ? (
				<Message from="assistant">
					<MessageContent>
						<MessageBubble variant="ghost">
							<MessageBubbleContent>
								{isLast ? (
									<FleetToolTimeline
										messages={turn.assistants}
										artifacts={artifacts}
										streaming={isStreaming}
									/>
								) : null}
								<div className="flex flex-col gap-3">{assistantElements}</div>
								{isLast && presentation ? (
									<FleetSubagentList
										children={presentation.rlmChildren}
										tree={presentation.rlmTree}
									/>
								) : null}
							</MessageBubbleContent>
						</MessageBubble>
					</MessageContent>
				</Message>
			) : null}
		</div>
	)
}

/**
 * Displays a subagent's metadata, transcript, artifacts, and current loading or error state.
 *
 * @param child - The subagent whose thread is displayed
 * @param parentSessionId - The active parent session identifier
 * @param transcript - The loaded transcript state for the subagent
 * @param onRefresh - Refreshes the subagent transcript
 */
function ChildTranscript({
	child,
	parentSessionId,
	transcript,
	onRefresh,
}: {
	child: PrimeAgentRlmChild
	parentSessionId?: string
	transcript?: TranscriptState
	onRefresh: () => void
}) {
	const turns = useMemo(
		() => (transcript?.status === "ready" ? groupMessages(transcript.messages) : []),
		[transcript],
	)
	const childStatus = transcriptStatus(child)
	const artifactRuns = useMemo(
		() =>
			transcript?.status === "ready"
				? derivePrimeAgentArtifactRuns(transcript.messages, transcript.presentation, childStatus)
				: [],
		[childStatus, transcript],
	)
	const artifacts = useMemo(
		() => artifactRuns.flatMap((run) => run.artifacts),
		[artifactRuns],
	)
	return (
		<section aria-label={`Subagent thread: ${child.label}`} className="space-y-2">
			<div className="flex min-w-0 items-start gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2">
				<Bot className="mt-0.5 size-3.5 shrink-0 text-foreground/45" />
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-2">
						<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">
							{child.sessionName || child.label}
						</span>
						<span className="shrink-0 text-[10px] capitalize text-foreground/45">{child.status}</span>
					</div>
					{child.model ? (
						<p className="truncate font-mono text-[10px] text-foreground/40">{child.model}</p>
					) : null}
					{child.answerPreview || child.recap ? (
						<p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] leading-4 text-foreground/55">
							{child.answerPreview ?? child.recap}
						</p>
					) : null}
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="shrink-0 text-foreground/40 hover:text-foreground/70"
					aria-label={`Refresh ${child.label} thread`}
					title={`Refresh ${child.label} thread`}
					onClick={onRefresh}
				>
					<RefreshCw className={cn("size-3.5", transcript?.status === "loading" && "animate-spin")} />
				</Button>
			</div>

			{!parentSessionId ? (
				<p className="rounded-md border border-dashed border-border/70 px-3 py-3 text-[11px] leading-4 text-foreground/45">
					This subagent thread is unavailable until the parent session is active.
				</p>
			) : transcript?.status === "loading" ? (
				<div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border/70 text-[11px] text-foreground/45">
					Loading subagent thread…
				</div>
			) : transcript?.status === "error" ? (
				<div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] leading-4 text-destructive">
					<AlertCircle className="mt-0.5 size-3.5 shrink-0" />
					<span>{transcript?.error?.message ?? "Unable to load this subagent thread."}</span>
				</div>
			) : turns.length === 0 ? (
				<p className="rounded-md border border-dashed border-border/70 px-3 py-3 text-[11px] leading-4 text-foreground/45">
					This subagent thread has no messages yet.
				</p>
			) : (
				<div className="h-96 min-h-64 max-h-[calc(100svh-18rem)] rounded-md border border-border/60 bg-background">
					<MessageScroller
						label={`Transcript for ${child.label}`}
						followOutput={false}
						smooth={false}
						contentClassName="flex flex-col gap-4 px-2.5 py-3"
					>
						{turns.map((turn, index) => {
							const isLast = index === turns.length - 1
							return (
								<SubagentTurnView
									key={turn.user?.id ?? `subagent-turn-${index}`}
									turn={turn}
									isLast={isLast}
									isStreaming={isLast && childStatus === "streaming"}
									artifacts={isLast ? artifacts : []}
									presentation={isLast ? transcript?.presentation : undefined}
								/>
							)
						})}
					</MessageScroller>
				</div>
			)}
		</section>
	)
}

/**
 * Displays delegated subagent threads and the selected child's transcript.
 *
 * @param agents - The delegated subagents to display.
 * @param loadSession - Loads a child subagent's transcript.
 * @param parentSessionId - Identifies the parent session containing the subagent threads.
 * @param tree - Optional delegation tree used to order and indent the subagents.
 */
export function SubagentsPanelContent({ agents, loadSession, parentSessionId, tree }: SubagentsPanelContentProps) {
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
			const requestKey = `${parentSessionId}:${agent.id}:${agent.status}:${agent.timestamp}`
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
	}, [loadTranscript, selectedAgent?.id, selectedAgent?.status, selectedAgent?.timestamp])

	if (ordered.length === 0) {
		return (
			<section aria-label="Subagents" className="flex min-h-36 items-center rounded-md border border-dashed border-border/70 px-4 text-center text-[12px] leading-5 text-foreground/45">
				Subagent threads will appear here when Prime delegates work.
			</section>
		)
	}

	return (
		<section aria-label="Subagents" className="space-y-2 pb-1">
			<div className="flex min-w-0 items-center gap-2 rounded-sm bg-foreground/5 px-2 py-1.5">
				<Bot className="size-3.5 shrink-0 text-foreground/45" />
				<span className="min-w-0 flex-1 truncate text-label font-medium text-foreground/70">
					Invoked subagents
				</span>
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
							onClick={() => setSelectedAgentId(agent.id)}
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
				<ChildTranscript
					child={selectedAgent}
					parentSessionId={parentSessionId}
					transcript={transcripts[selectedAgent.id]}
					onRefresh={() => void loadTranscript(selectedAgent, true)}
				/>
			) : null}
		</section>
	)
}
