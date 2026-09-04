"use client"

import { Check, Gauge } from "lucide-react"
import { useMemo } from "react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../ui/command"
import { Slider } from "../../../ui/slider"
import type {
  ModelSelectorEffort,
  ModelSelectorModel,
} from "./model-selector"

export interface ModelSelectorListProps {
  models: readonly ModelSelectorModel[]
  selectedModel: ModelSelectorModel | undefined
  selectedEffort: ModelSelectorEffort | undefined
  effortLabel: string
  onModelChange?: (modelId: string) => void
  onEffortChange?: (effortId: string) => void
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

/**
 * Searchable model/effort list. Split from `model-selector` so the cmdk
 * dependency stays out of the welcome-route eager graph (see
 * web/app/scripts/check-bundle-budget.mjs) — this module only loads when the
 * selector popover opens.
 */
export function ModelSelectorList({
  models,
  selectedModel,
  selectedEffort,
  effortLabel,
  onModelChange,
  onEffortChange,
}: ModelSelectorListProps) {
  const groups = useMemo(() => groupModels(models), [models])

  return (
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
  )
}
