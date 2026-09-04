"use client"

import { ChevronDown } from "lucide-react"
import { lazy, memo, Suspense, useId, useState, type ComponentProps, type ReactNode } from "react"
import { Popover } from "../../beui/agents/input/input-popover"
import { cn } from "../../../../lib/utils"

const LazyModelSelectorList = lazy(() =>
  import("./model-selector-list").then(({ ModelSelectorList }) => ({
    default: ModelSelectorList,
  }))
)

function ModelSelectorList(props: ComponentProps<typeof LazyModelSelectorList>) {
  return (
    <Suspense fallback={<div className="h-24 animate-pulse rounded-md bg-muted/40 p-1.5" aria-label="Loading models" role="status" />}>
      <LazyModelSelectorList {...props} />
    </Suspense>
  )
}

export type ModelSelectorEffort = {
  id: string
  name: string
  description?: string
  disabled?: boolean
}

export type ModelSelectorModel = {
  id: string
  name: string
  provider: string
  providerLabel?: string
  modelId?: string
  description?: string
  icon?: ReactNode
  disabled?: boolean
  reasoning?: boolean
  efforts?: readonly ModelSelectorEffort[]
  keywords?: readonly string[]
}

export type ModelSelectorProps = {
  models: readonly ModelSelectorModel[]
  value?: string
  effort?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onModelChange?: (modelId: string) => void
  onEffortChange?: (effort: string) => void
  placeholder?: string
  effortLabel?: string
  className?: string
  contentClassName?: string
}

export const ModelSelector = memo(function ModelSelector({
  models,
  value,
  effort,
  open: controlledOpen,
  onOpenChange,
  onModelChange,
  onEffortChange,
  placeholder = "Model",
  effortLabel = "Reasoning effort",
  className,
  contentClassName,
}: ModelSelectorProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const popupId = useId()
  const open = controlledOpen ?? internalOpen
  const handleOpenChange = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }
  const selectedModel = models.find((model) => model.id === value) ?? models[0]
  const selectedEffort = selectedModel?.efforts?.find((option) => option.id === effort)
    ?? selectedModel?.efforts?.[0]

  const trigger = (
    <button
      type="button"
      role="combobox"
      aria-expanded={open}
      aria-controls={popupId}
      aria-haspopup="dialog"
      aria-label="Select model and reasoning effort"
      className={cn(
        "relative inline-flex h-8 max-w-[18rem] min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {selectedModel?.icon ? <span className="shrink-0">{selectedModel.icon}</span> : null}
      <span className="min-w-0 truncate font-medium">{selectedModel?.name ?? placeholder}</span>
      {selectedEffort && selectedModel?.reasoning ? (
        <span className="hidden shrink-0 text-muted-foreground/70 xl:inline">· {selectedEffort.name}</span>
      ) : null}
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
    </button>
  )

  return (
    <Popover
      contentId={popupId}
      open={open}
      onOpenChange={handleOpenChange}
      side="top"
      align="start"
      className={cn(
        "w-[min(24rem,calc(100vw-2rem))] max-h-[min(55vh,28rem)] overflow-hidden p-0",
        contentClassName,
      )}
      trigger={trigger}
    >
      <ModelSelectorList
        models={models}
        selectedModel={selectedModel}
        selectedEffort={selectedEffort}
        effortLabel={effortLabel}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
      />
    </Popover>
  )
})
