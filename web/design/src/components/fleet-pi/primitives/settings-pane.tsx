import { Loader2, RotateCcw, Save } from "lucide-react"
import { Button } from "../../button"
import { cn } from "../../../lib/utils"
import { COMPACT_ACTION_BUTTON_CLASS } from "../styles/tokens"
import type { ReactNode } from "react"

/**
 * Shared Settings content chrome: title + description left, actions right.
 * Keeps Commit with the pane header instead of an orphaned toolbar.
 */
export function SettingsPane({
  actions,
  children,
  description,
  title,
}: {
  actions?: ReactNode
  children: ReactNode
  description: ReactNode
  title: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-medium text-balance">{title}</h3>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            {actions}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

export function SettingsCommitActions({
  dirty,
  disabled,
  onRevert,
  onSave,
  saving,
}: {
  dirty: boolean
  disabled: boolean
  onRevert: () => void
  onSave: () => void
  saving: boolean
}) {
  return (
    <>
      {dirty ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground transition-transform active:scale-[0.96]"
          disabled={disabled || saving}
          onClick={onRevert}
          aria-label="Revert changes"
        >
          <RotateCcw />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          COMPACT_ACTION_BUTTON_CLASS,
          "transition-transform active:scale-[0.96]",
          dirty && "border-primary/30 text-primary"
        )}
        disabled={!dirty || disabled || saving}
        onClick={onSave}
      >
        {saving ? (
          <Loader2 className="animate-spin" data-icon="inline-start" />
        ) : (
          <Save data-icon="inline-start" />
        )}
        Commit
      </Button>
    </>
  )
}
