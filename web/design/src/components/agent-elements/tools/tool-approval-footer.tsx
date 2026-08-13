import { memo, useMemo, useState } from "react"

export type ToolApproval = {
  approveLabel?: string
  rejectLabel?: string
  onApprove?: () => void
  onReject?: () => void
}

export type ToolApprovalFooterProps = ToolApproval & {
  isPending?: boolean
}

export const ToolApprovalFooter = memo(function ToolApprovalFooter({
  isPending,
  approveLabel,
  rejectLabel,
  onApprove,
  onReject,
}: ToolApprovalFooterProps) {
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(null)

  const approveText =
    decision === "approved" ? "Approved" : (approveLabel ?? "Next")
  const rejectText =
    decision === "rejected" ? "Skipped" : (rejectLabel ?? "Skip")

  const handleApprove = () => {
    if (decision) return
    setDecision("approved")
    onApprove?.()
  }

  const handleReject = () => {
    if (decision) return
    setDecision("rejected")
    onReject?.()
  }

  const statusConfig = useMemo(() => {
    if (decision === "approved") return { label: "Waiting", dots: true }
    if (decision === "rejected") return { label: "Canceled", dots: false }
    if (isPending) return { label: "Starting", dots: true }
    // Default "ready" state — buttons themselves communicate the affordance,
    // an extra "Ready" label just adds noise. Render an empty spacer so the
    // buttons stay right-aligned via justify-between.
    return null
  }, [decision, isPending])

  return (
    <div className="flex items-center justify-between border-t border-border bg-an-tool-background py-1 pr-2 pl-3">
      {statusConfig ? (
        <span className="text-xs text-an-tool-color-muted">
          {statusConfig.label}
          {statusConfig.dots && (
            <span className="inline-flex" aria-hidden="true">
              <span className="animate-[loading-dots_1.4s_infinite_0.2s] text-an-tool-color-muted">
                .
              </span>
              <span className="animate-[loading-dots_1.4s_infinite_0.4s] text-an-tool-color-muted">
                .
              </span>
              <span className="animate-[loading-dots_1.4s_infinite_0.6s] text-an-tool-color-muted">
                .
              </span>
            </span>
          )}
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={handleReject}
          disabled={Boolean(decision)}
          className="h-5 rounded-[4px] px-1.5 text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted/50 hover:text-an-tool-color active:scale-[0.98] disabled:opacity-60 disabled:hover:bg-transparent disabled:active:scale-100"
        >
          {rejectText}
        </button>
        <button
          type="button"
          onClick={handleApprove}
          disabled={Boolean(decision)}
          className="h-5 rounded-[4px] bg-an-primary-color px-1.5 text-xs font-medium text-an-send-button-color transition-[background-color,transform] duration-150 hover:bg-an-primary-color/90 active:scale-[0.98] disabled:opacity-60 disabled:hover:bg-an-primary-color disabled:active:scale-100"
        >
          {approveText}
        </button>
      </div>
    </div>
  )
})
