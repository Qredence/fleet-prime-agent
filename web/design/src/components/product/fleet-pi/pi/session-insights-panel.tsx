import type { ReactNode } from "react"
import type { PrimeAgentGoal } from "@prime-agent/web-protocol/chat-protocol"
import {
  RLM_CHILD_STATUSES,
  deriveSessionInsights,
  type SessionInsightsInput,
} from "./session-insights"

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
  const rlmSummary = RLM_CHILD_STATUSES.map(
    (state) => `${insights.rlmChildren[state]} ${state}`,
  ).join(" · ")

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
