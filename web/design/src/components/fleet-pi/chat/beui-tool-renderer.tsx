"use client"

import { CheckCircle2, Terminal, Wrench } from "lucide-react"
import { memo, type ReactNode } from "react"
import { CodeBlock } from "../../agents/code-block"
import { Citations } from "../../agents/citations"
import { FileDiff } from "../../agents/file-diff"
import { ImageGeneration } from "../../agents/image-generation"
import { TodoList, type TodoItem } from "../../agents/todo-list"
import { FleetAgentPlan, fleetAgentPlanPresentation, type FleetPlanItem } from "../../elements/fleet-agent-plan"
import { ToolApproval } from "../../agents/tool-approval"
import { ToolResult, ToolResultOutput, type ToolResultStatus } from "../../agents/tool-result"
import type { AgentCodeLanguage } from "../../agents/agent-code"
import type { ToolRendererProps } from "../../agents/tools/tool-renderer"
import {
  normalizeFleetToolPart,
  type FleetToolRecord,
} from "./beui-tool-normalizer"

/** Map todo-list items (hyphen status) into the Agent-Plan item model (underscore status). */
function toFleetPlanItems(items: readonly TodoItem[]): FleetPlanItem[] {
  return items.map((item) => ({
    id: String(item.id),
    title: typeof item.title === "string" ? item.title : "",
    status:
      item.status === "in-progress"
        ? "in_progress"
        : item.status === "completed"
          ? "completed"
          : item.status === "cancelled"
            ? "cancelled"
            : "pending",
  }))
}

function statusIcon(status: ToolResultStatus, name: string) {
  if (name.toLowerCase().includes("bash") || name.toLowerCase().includes("shell")) {
    return <Terminal aria-hidden="true" className="size-4" />
  }
  if (status === "success") return <CheckCircle2 aria-hidden="true" className="size-4" />
  return <Wrench aria-hidden="true" className="size-4" />
}

function Approval({
  approval,
  name,
  status,
}: {
  approval?: FleetToolRecord
  name: string
  status: ToolResultStatus
}) {
  if (!approval) return null
  const approvalStatus = status === "running" ? "pending" : status === "error" ? "error" : "complete"
  const parameters = Object.entries(approval).flatMap(([id, value]) => {
    if (typeof value === "object" || typeof value === "function") return []
    return [{ id, label: id, value: String(value) }]
  })
  return (
    <ToolApproval
      tool={name}
      title="Fleet Prime permission"
      description="This tool reported a permission decision from Fleet Prime."
      parameters={parameters}
      status={approvalStatus}
    />
  )
}

function SourceBlock({
	code,
	language,
	languageLabel,
	status,
}: {
	code: string
	language: AgentCodeLanguage
	languageLabel?: string
	status: ToolResultStatus
}) {
	return (
		<CodeBlock
			code={code}
			language={language}
			languageLabel={languageLabel}
			status={status === "running" ? "streaming" : "complete"}
			showStatus={false}
			maxHeight={160}
      showLineNumbers={false}
      wrap
    />
  )
}

export const BeuiToolRenderer = memo(function BeuiToolRenderer({
  part,
  chatStatus,
  fallback,
}: ToolRendererProps & { fallback?: ReactNode }) {
  const normalized = normalizeFleetToolPart(part, chatStatus)
  if (!normalized || normalized.lowerName === "question") return fallback ?? null

  const { detail, status } = normalized
  if (!detail) return fallback ?? null

  if (detail.kind === "todo") {
    const planItems = toFleetPlanItems(detail.items)
    const pendingDecision = Boolean(
      (part.input as { pendingDecision?: unknown } | undefined)?.pendingDecision,
    )
    // A plan awaiting an Execute/Stay/Refine decision must keep its controls:
    // the fallback PlanWrite renderer owns them, so never swap it out.
    if (normalized.lowerName === "planwrite" && pendingDecision) {
      return fallback ?? null
    }
    const planPresentation =
      normalized.lowerName === "planwrite" && Boolean((part.input as { executing?: unknown } | undefined)?.executing)
        ? fleetAgentPlanPresentation(planItems)
        : undefined

    if (planPresentation) {
      return <FleetAgentPlan presentation={planPresentation} className="mb-2" />
    }

    return (
      <TodoList
        items={detail.items}
        title={detail.title}
        defaultOpen
        collapseOnComplete={false}
        maxHeight={240}
      />
    )
  }

  if (detail.kind === "citations") {
    return (
      <Citations
        citations={detail.citations}
        title="Sources"
        defaultOpen
      />
    )
  }

  if (detail.kind === "image") {
    return (
      <ImageGeneration
        status={status === "running" ? "generating" : status === "error" ? "error" : "complete"}
      >
        <img src={detail.url} alt="Generated result" className="h-auto max-h-80 w-full object-contain" />
      </ImageGeneration>
    )
  }

  if (detail.kind === "diff") {
    return (
      <FileDiff
        file={detail.file}
        lines={detail.lines}
        status={status === "running" ? "streaming" : "complete"}
        language="diff"
        maxHeight={240}
        copyText={detail.copyText}
      />
    )
  }

  const content = detail.content || "No output."
  return (
    <ToolResult
      tool="Prime"
      title={normalized.name}
      status={status}
      kind={normalized.lowerName.includes("bash") || normalized.lowerName.includes("shell") || normalized.lowerName.includes("python") ? "terminal" : "custom"}
      meta={normalized.metadata.length > 0 ? normalized.metadata.join(" · ") : undefined}
      icon={statusIcon(status, normalized.name)}
      defaultOpen
      collapseOnComplete={false}
      maxHeight={240}
      copyText={content}
    >
      {detail.sourceCode ? (
        <SourceBlock
          code={detail.sourceCode}
          language={detail.sourceLanguage ?? "text"}
          languageLabel={detail.sourceLabel}
          status={status}
        />
      ) : null}
      {detail.sections.map((section) => (
        <ToolResultOutput key={section.label} language={section.language} label={section.label}>
          {section.content}
        </ToolResultOutput>
      ))}
      <Approval approval={normalized.approval} name={normalized.name} status={status} />
    </ToolResult>
  )
})
