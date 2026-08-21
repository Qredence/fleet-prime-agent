"use client"

import { Check, ChevronDown, Gauge } from "lucide-react"
import { memo, useId, useMemo, useState, type ReactNode } from "react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../command"
import { Popover } from "../agent-elements/input/popover"
import { Slider } from "../slider"
import { cn } from "../../lib/utils"

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

function groupModels(models: readonly ModelSelectorModel[]) {
  const groups = new Map<string, ModelSelectorModel[]>()
  for (const model of models) {
    const group = groups.get(model.provider) ?? []
    group.push(model)
    groups.set(model.provider, group)
  }
  return [...groups.entries()]
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
  const groups = useMemo(() => groupModels(models), [models])
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
      <Command className="min-h-0 max-h-[min(55vh,28rem)] bg-transparent" shouldFilter>
        <CommandInput placeholder="Search models…" aria-label="Search models" />
        <CommandList className="min-h-0 flex-1 p-1.5">
          <CommandEmpty>No matching models</CommandEmpty>
          {groups.map(([provider, providerModels]) => (
            <CommandGroup
              key={provider}
              heading={providerModels[0]?.providerLabel ?? provider}
            >
              {providerModels.map((model) => {
                const searchValue = [
                  model.id,
                  model.name,
                  model.provider,
                  model.providerLabel,
                  model.modelId,
                  ...(model.keywords ?? []),
                ]
                  .filter(Boolean)
                  .join(" ")
                const selected = model.id === selectedModel?.id
                return (
                  <CommandItem
                    key={model.id}
                    value={searchValue}
                    disabled={model.disabled}
                    onSelect={() => {
                      if (model.disabled) return
                      onModelChange?.(model.id)
                    }}
                    className="items-start gap-2 rounded-lg px-2.5 py-2"
                  >
                    <span className="mt-0.5 shrink-0 text-muted-foreground">
                      {model.icon ?? <Gauge aria-hidden="true" className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{model.name}</span>
                        {model.disabled ? (
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">Unavailable</span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {model.modelId ?? model.id}
                        {model.reasoning ? " · reasoning" : ""}
                      </span>
                      {model.description ? (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">{model.description}</span>
                      ) : null}
                    </span>
                    {selected ? <Check aria-hidden="true" className="mt-1 size-4 shrink-0" /> : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>
        {selectedModel?.reasoning && selectedModel.efforts?.length ? (
          <div className="shrink-0 border-t border-border/70 p-2">
            <Slider
              label={effortLabel}
              value={Math.max(0, selectedModel.efforts.findIndex((option) => option.id === selectedEffort?.id))}
              onChange={(nextValue) => {
                const option = selectedModel.efforts?.[Math.round(nextValue)]
                if (option && !option.disabled) onEffortChange?.(option.id)
              }}
              min={0}
              max={Math.max(0, selectedModel.efforts.length - 1)}
              formatValue={(nextValue) => selectedModel.efforts?.[Math.round(nextValue)]?.name ?? ""}
            />
          </div>
        ) : null}
      </Command>
    </Popover>
  )
})
