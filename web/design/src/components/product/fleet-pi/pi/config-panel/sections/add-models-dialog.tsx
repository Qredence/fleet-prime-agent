import { RefreshCw, Search } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "../../../../../ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../../../ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../../../../../ui/input-group"
import { Spinner } from "../../../../../ui/spinner"
import { cn } from "../../../../../../lib/utils"
import { isModelEnabled } from "../shared/model-patterns"
import {
  ProviderBrandIcon,
  formatProviderLabel,
} from "../shared/provider-brand-icon"
import type { ChatPiSettings } from "@prime-agent/web-protocol/chat-protocol"
import type { ConfigModelInfo } from "../shared/types"

export type AddModelsDialogProps = {
  configuredProviderIds: ReadonlySet<string>
  /** Providers whose models.json base URL allows live model discovery. */
  discoverableProviderIds?: ReadonlySet<string>
  discoveringProviderId: string | null
  enabledModels: ChatPiSettings["enabledModels"] | undefined
  modelOptions: Array<ConfigModelInfo>
  onAddModels: (models: Array<ConfigModelInfo>) => void
  onDiscoverProvider: (providerId: string) => Promise<void>
  onOpenChange: (open: boolean) => void
  /** Preferred labels for custom/OCC instance ids (display names). */
  providerLabel?: (providerId: string) => string
}

function searchableModelText(model: ConfigModelInfo) {
  return [model.name, model.modelId, model.provider, model.id]
    .join(" ")
    .toLowerCase()
}

export function AddModelsDialog({
  configuredProviderIds,
  discoverableProviderIds,
  discoveringProviderId,
  enabledModels,
  modelOptions,
  onAddModels,
  onDiscoverProvider,
  onOpenChange,
  providerLabel = formatProviderLabel,
}: AddModelsDialogProps) {
  const [filter, setFilter] = useState("")
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const normalizedFilter = filter.trim().toLowerCase()

  const candidateModels = useMemo(() => {
    return modelOptions.filter((model) => {
      if (!configuredProviderIds.has(model.provider)) return false
      if (isModelEnabled(model, enabledModels)) return false
      return !normalizedFilter || searchableModelText(model).includes(normalizedFilter)
    })
  }, [configuredProviderIds, enabledModels, modelOptions, normalizedFilter])

  const groupedCandidates = useMemo(() => {
    const groups = new Map<string, Array<ConfigModelInfo>>()
    for (const model of candidateModels) {
      const existing = groups.get(model.provider)
      if (existing) existing.push(model)
      else groups.set(model.provider, [model])
    }
    return [...groups.entries()]
  }, [candidateModels])

  const discoverableProviders = useMemo(() => {
    // Only providers with a recorded base URL can serve GET {baseUrl}/models;
    // built-ins come from the engine's static registry instead.
    const ids = discoverableProviderIds ?? configuredProviderIds
    return Array.from(ids)
      .filter((id) => configuredProviderIds.has(id))
      .sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)))
  }, [configuredProviderIds, discoverableProviderIds, providerLabel])

  /** Enabled-model count per provider, for the "N active" group labels. */
  const activeCountByProvider = useMemo(() => {
    const counts = new Map<string, number>()
    for (const model of modelOptions) {
      if (isModelEnabled(model, enabledModels)) {
        counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1)
      }
    }
    return counts
  }, [enabledModels, modelOptions])

  const toggleSelected = (model: ConfigModelInfo) => {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(model.id)) next.delete(model.id)
      else next.add(model.id)
      return next
    })
  }

  const confirmAdd = () => {
    const selected = candidateModels.filter((model) => selectedKeys.has(model.id))
    if (selected.length > 0) onAddModels(selected)
    onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add models</DialogTitle>
          <DialogDescription>
            Pick models discovered from your configured providers. For OpenAI Chat
            Completions, refresh runs{" "}
            <span className="font-medium">GET {"{baseUrl}/models"}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {discoverableProviders.map((providerId) => {
            const discovering = discoveringProviderId === providerId
            const activeCount = activeCountByProvider.get(providerId) ?? 0
            return (
              <Button
                key={providerId}
                type="button"
                variant="outline"
                size="sm"
                disabled={discoveringProviderId !== null}
                onClick={() => {
                  void onDiscoverProvider(providerId)
                }}
              >
                {discovering ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCw data-icon="inline-start" />
                )}
                {providerLabel(providerId)}
                {activeCount > 0 ? (
                  <span className="tabular-nums text-muted-foreground">
                    · {activeCount} active
                  </span>
                ) : null}
              </Button>
            )
          })}
        </div>

        <InputGroup>
          <InputGroupAddon align="inline-start">
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search discovered models"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search discovered models…"
          />
        </InputGroup>

        <div className="max-h-72 overflow-y-auto">
          {groupedCandidates.length === 0 ? (
            <p className="py-6 text-center text-xs text-pretty text-muted-foreground">
              {candidateModels.length === 0 && !normalizedFilter
                ? "All discovered models are already in your list, or none are available yet."
                : "No models match your search."}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {groupedCandidates.map(([provider, models]) => (
                <div key={provider} className="flex flex-col gap-1">
                  <div className="px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {providerLabel(provider)}
                    {(activeCountByProvider.get(provider) ?? 0) > 0 ? (
                      <span className="ml-1 font-normal normal-case tabular-nums">
                        · {activeCountByProvider.get(provider)} active
                      </span>
                    ) : null}
                  </div>
                  {models.map((model) => {
                    const checked = selectedKeys.has(model.id)
                    return (
                      <button
                        key={model.id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-[background-color,transform] duration-150",
                          "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.96]",
                          checked && "bg-muted/70"
                        )}
                        aria-pressed={checked}
                        onClick={() => toggleSelected(model)}
                      >
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-[4px] border border-border/40 bg-background/60">
                          <ProviderBrandIcon
                            provider={model.provider}
                            className="text-foreground/70"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {model.name}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {model.modelId}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "size-4 rounded border border-border/60",
                            checked && "border-foreground bg-foreground"
                          )}
                          aria-hidden
                        />
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={selectedKeys.size === 0}
            onClick={confirmAdd}
          >
            Add{" "}
            {selectedKeys.size > 0 ? (
              <span className="tabular-nums">({selectedKeys.size})</span>
            ) : null}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
