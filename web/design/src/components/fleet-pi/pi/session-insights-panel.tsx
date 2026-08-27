import type { ReactNode } from "react"
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type {
  ChatMode,
  ChatThinkingLevel,
  PrimeAgentArtifactRun,
  PrimeAgentGoal,
  PrimeAgentSessionPresentation,
  QueueState,
} from "@prime-agent/web-protocol/chat-protocol"

export type SessionInsightsInput = {
  activityLabel?: string
  artifactRuns: Array<PrimeAgentArtifactRun>
  chatMode: ChatMode
  messages: Array<ChatMessage>
  planLabel?: string
  presentation: PrimeAgentSessionPresentation
  queue: QueueState
  selectedModelKey?: string
  sessionId?: string
  status: ChatStatus
  thinkingLevel?: ChatThinkingLevel
}

const RLM_CHILD_STATUSES = ["queued", "running", "done", "error", "cancelled"] as const

export type SessionInsights = {
  activity: string
  artifactCount: number
  assistantMessages: number
  bashCommands: number
  goal?: PrimeAgentGoal
  ipythonCells: number
  queuedFollowUps: number
  queuedSteering: number
  refinements: { failed: number; successful: number; total: number }
  rlmChildren: Record<(typeof RLM_CHILD_STATUSES)[number], number>
  userMessages: number
}

export function deriveSessionInsights({
  activityLabel,
  artifactRuns,
  messages,
  planLabel,
  presentation,
  queue,
}: Pick<
  SessionInsightsInput,
  "activityLabel" | "artifactRuns" | "messages" | "planLabel" | "presentation" | "queue"
>): SessionInsights {
  const rlmChildren = Object.fromEntries(RLM_CHILD_STATUSES.map((status) => [status, 0])) as SessionInsights["rlmChildren"]
  for (const child of presentation.rlmChildren) rlmChildren[child.status] += 1

  const refinements = presentation.refinements.reduce(
    (counts, refinement) => ({
      failed: counts.failed + Number(refinement.status === "error"),
      successful: counts.successful + Number(refinement.status === "success"),
      total: counts.total + 1,
    }),
    { failed: 0, successful: 0, total: 0 },
  )
  const artifacts = artifactRuns.flatMap((run) => run.artifacts)

  return {
    activity: activityLabel || planLabel || "Waiting for input",
    artifactCount: artifacts.length,
    assistantMessages: messages.filter((message) => message.role === "assistant").length,
    bashCommands: presentation.userBash.length,
    goal: presentation.goal,
    ipythonCells: artifacts.filter((artifact) => artifact.kind === "ipython").length,
    queuedFollowUps: queue.followUp.length,
    queuedSteering: queue.steering.length,
    refinements,
    rlmChildren,
    userMessages: messages.filter((message) => message.role === "user").length,
  }
}

function humanize(value: string): string {
  return value.replaceAll("_", " ")
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`
  return `${remainingSeconds}s`
}

function DetailList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section
      aria-label={label}
      className="rounded-md border border-border/60 bg-background px-3 py-2.5 shadow-[0_1px_4px_-1px_rgba(0,0,0,0.06)]"
    >
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-foreground/45">{label}</h3>
      <dl className="space-y-1.5 text-[12px]">{children}</dl>
    </section>
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-foreground/50">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-foreground/80">{value}</dd>
    </div>
  )
}

function GoalDetails({ goal }: { goal: PrimeAgentGoal }) {
  return (
    <DetailList label="Goal">
      <Detail label="Status" value={humanize(goal.status)} />
      {goal.objective ? (
        <Detail label="Objective" value={<span className="block max-w-56 text-pretty">{goal.objective}</span>} />
      ) : null}
      <Detail label="Elapsed" value={formatDuration(goal.timeUsedSeconds)} />
      <Detail label="Token usage" value={goal.tokensUsed} />
      {goal.tokenBudget !== undefined ? <Detail label="Token budget" value={goal.tokenBudget} /> : null}
      <Detail label="Continuations" value={goal.continuationsUsed} />
    </DetailList>
  )
}

export function SessionInsightsPanel({
  activityLabel,
  artifactRuns,
  chatMode,
  messages,
  planLabel,
  presentation,
  queue,
  selectedModelKey,
  sessionId,
  status,
  thinkingLevel,
}: SessionInsightsInput) {
  if (!sessionId) {
    return (
      <section
        aria-label="Session insights"
        className="flex min-h-36 items-center rounded-md border border-dashed border-border/70 px-4 text-center text-[12px] leading-5 text-foreground/45"
      >
        Start or open a session to view its live insights.
      </section>
    )
  }

  const insights = deriveSessionInsights({ activityLabel, artifactRuns, messages, planLabel, presentation, queue })
  const rlmSummary = RLM_CHILD_STATUSES
    .map((state) => [state, insights.rlmChildren[state]] as const)
    .map(([state, count]) => `${count} ${state}`)
    .join(" · ")

  return (
    <section aria-label="Session insights" className="space-y-2.5 pb-1">
      <DetailList label="Current state">
        <Detail label="Run status" value={status} />
        <Detail label="Activity" value={<span className="block max-w-56 text-pretty">{insights.activity}</span>} />
        <Detail label="Queued steering" value={insights.queuedSteering} />
        <Detail label="Queued follow-ups" value={insights.queuedFollowUps} />
      </DetailList>

      {insights.goal ? <GoalDetails goal={insights.goal} /> : null}

      <DetailList label="Configuration">
        <Detail label="Model" value={selectedModelKey ?? "Not selected"} />
        <Detail label="Mode" value={chatMode} />
        <Detail label="Reasoning" value={thinkingLevel ?? presentation.thinkingLevel ?? "Not set"} />
      </DetailList>

      <DetailList label="Progress">
        <Detail label="User messages" value={insights.userMessages} />
        <Detail label="Assistant messages" value={insights.assistantMessages} />
        <Detail label="Artifacts" value={insights.artifactCount} />
        <Detail label="Bash commands" value={insights.bashCommands} />
        <Detail label="IPython cells" value={insights.ipythonCells} />
        <Detail label="RLM children" value={rlmSummary || "None"} />
        <Detail
          label="Refinements"
          value={`${insights.refinements.total} total · ${insights.refinements.successful} successful · ${insights.refinements.failed} failed`}
        />
      </DetailList>

      {presentation.recap ? (
        <DetailList label="Existing recap">
          <Detail
            label="Summary"
            value={<span className="block max-w-56 whitespace-pre-wrap text-left text-pretty">{presentation.recap}</span>}
          />
        </DetailList>
      ) : null}
    </section>
  )
}
