"use client"

import { CheckCircle2, Terminal, Wrench } from "lucide-react"
import { memo, type ReactNode } from "react"
import { CodeBlock } from "../../agents/code-block"
import { Citations } from "../../agents/citations"
import { FileDiff } from "../../agents/file-diff"
import { ImageGeneration } from "../../agents/image-generation"
import { TodoList } from "../../agents/todo-list"
import { ToolApproval } from "../../agents/tool-approval"
import { ToolResult, ToolResultOutput, type ToolResultStatus } from "../../agents/tool-result"
import type { ToolRendererProps } from "../../agent-elements/tools/tool-renderer"
import {
  normalizeFleetToolPart,
  type FleetToolRecord,
} from "./beui-tool-normalizer"

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
      title="Prime Agent permission"
      description="This tool reported a permission decision from Prime Agent."
      parameters={parameters}
      status={approvalStatus}
    />
  )
}

function SourceBlock({
  code,
  language,
  status,
}: {
  code: string
  language: "bash" | "json" | "text" | "tsx" | "typescript"
  status: ToolResultStatus
}) {
  return (
    <CodeBlock
      code={code}
      language={language}
      status={status === "running" ? "streaming" : "complete"}
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
    return (
      <TodoList
        items={detail.items}
        title={detail.title}
        defaultOpen={status === "running"}
        collapseOnComplete
        maxHeight={240}
      />
    )
  }

  if (detail.kind === "citations") {
    return (
      <Citations
        citations={detail.citations}
        title="Sources"
        defaultOpen={status === "running"}
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
      defaultOpen={status === "running"}
      collapseOnComplete
      maxHeight={240}
      copyText={content}
    >
      {detail.sourceCode ? (
        <SourceBlock
          code={detail.sourceCode}
          language={detail.sourceLanguage === "bash" ? "bash" : "text"}
          status={status}
        />
      ) : null}
      {detail.content ? (
        detail.structured ? (
          <CodeBlock
            code={detail.content}
            language="json"
            status={status === "running" ? "streaming" : "complete"}
            maxHeight={220}
            showLineNumbers={false}
            wrap
          />
        ) : (
          <ToolResultOutput language={detail.language}>{detail.content}</ToolResultOutput>
        )
      ) : null}
      <Approval approval={normalized.approval} name={normalized.name} status={status} />
    </ToolResult>
  )
})
