import { Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "../../../../button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../../dialog"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../../../../input-group"
import { Spinner } from "../../../../spinner"
import { cn } from "../../../../../lib/utils"
import { ItemRow } from "../../../primitives/item-row"
import {
  SettingsCommitActions,
  SettingsPane,
} from "../../../primitives/settings-pane"
import { HIT_AREA_EXPAND_DENSE_CLASS } from "../../../styles/tokens"
import { isModelEnabled } from "../shared/model-patterns"
import {
  ProviderBrandIcon,
  formatProviderLabel,
} from "../shared/provider-brand-icon"
import type { ChatPiSettings } from "@prime-agent/web-protocol/chat-protocol"
import type { ConfigModelInfo } from "../shared/types"

export function ModelDefaultsSection({
  draft,
  discoveringProviderId,
  modelDirty,
  modelFilter,
  modelOptions,
  onAddModels,
  onDiscoverProvider,
  onModelFilterChange,
  onRemoveModel,
  onRevert,
  onSave,
  providers,
  saving,
  settingsLoading,
}: {
  draft: ChatPiSettings | null
  discoveringProviderId: string | null
  modelDirty: boolean
  modelFilter: string
  modelOptions: Array<ConfigModelInfo>
  onAddModels: (models: Array<ConfigModelInfo>) => void
  onDiscoverProvider: (providerId: string) => Promise<void>
  onModelFilterChange: (value: string) => void
  onRemoveModel: (model: ConfigModelInfo) => void
  onRevert: () => void
  onSave: () => void
  providers: Array<{ id: string; isConfigured: boolean }>
  saving: boolean
  settingsLoading: boolean
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [addFilter, setAddFilter] = useState("")
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const disabled = !draft || settingsLoading
  const normalizedFilter = modelFilter.trim().toLowerCase()
  const normalizedAddFilter = addFilter.trim().toLowerCase()

  const configuredProviderIds = useMemo(() => {
    // Trust the server (prime-agent-driven /api/chat/providers). Anything it
    // reports as configured is candidate visibility for the model-defaults
    // section — including custom providers like `modal` from models.json.
    const ids = new Set<string>()
    for (const provider of providers) {
      if (provider.isConfigured) {
        ids.add(provider.id)
      }
    }
    // Keep providers already on the curated list discoverable after refresh.
    for (const model of modelOptions) {
      if (isModelEnabled(model, draft?.enabledModels)) {
        ids.add(model.provider)
      }
    }
    return ids
  }, [draft?.enabledModels, modelOptions, providers])

  const listedModels = useMemo(() => {
    return modelOptions.filter((model) => {
      if (!isModelEnabled(model, draft?.enabledModels)) return false
      if (!normalizedFilter) return true
      return [model.name, model.modelId, model.provider, model.id]
        .join(" ")
        .toLowerCase()
        .includes(normalizedFilter)
    })
  }, [draft?.enabledModels, modelOptions, normalizedFilter])

  const groupedListed = useMemo(() => {
    const groups = new Map<string, Array<ConfigModelInfo>>()
    for (const model of listedModels) {
      const existing = groups.get(model.provider)
      if (existing) existing.push(model)
      else groups.set(model.provider, [model])
    }
    return [...groups.entries()]
  }, [listedModels])

  const candidateModels = useMemo(() => {
    return modelOptions.filter((model) => {
      if (!configuredProviderIds.has(model.provider)) return false
      if (isModelEnabled(model, draft?.enabledModels)) return false
      if (!normalizedAddFilter) return true
      return [model.name, model.modelId, model.provider, model.id]
        .join(" ")
        .toLowerCase()
        .includes(normalizedAddFilter)
    })
  }, [
    configuredProviderIds,
    draft?.enabledModels,
    modelOptions,
    normalizedAddFilter,
  ])

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
    return [...configuredProviderIds].sort((a, b) =>
      formatProviderLabel(a).localeCompare(formatProviderLabel(b))
    )
  }, [configuredProviderIds])

  const emptyMessage = (() => {
    if (modelOptions.length === 0) {
      return "No models discovered yet. Configure a provider, then add models."
    }
    if (listedModels.length === 0 && !normalizedFilter) {
      return "Add models from your configured providers to make them available in chat."
    }
    if (listedModels.length === 0) {
      return "No models match your search."
    }
    return null
  })()

  const openAddDialog = () => {
    setSelectedKeys(new Set())
    setAddFilter("")
    setAddOpen(true)
  }

  const toggleSelected = (model: ConfigModelInfo) => {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(model.id)) next.delete(model.id)
      else next.add(model.id)
      return next
    })
  }

  const confirmAdd = () => {
    const selected = candidateModels.filter((model) =>
      selectedKeys.has(model.id)
    )
    if (selected.length > 0) onAddModels(selected)
    setAddOpen(false)
    setSelectedKeys(new Set())
  }

  return (
    <SettingsPane
      title="LLM Models"
      description={
        <>
          Models available in chat. Discover from configured providers, add the
          ones you want, and remove any you do not need — changes save
          automatically.{" "}
          <span className="tabular-nums">{listedModels.length}</span> in list
          {modelOptions.length > 0 ? (
            <>
              {" "}
              · <span className="tabular-nums">{modelOptions.length}</span>{" "}
              discovered
            </>
          ) : null}
          .
        </>
      }
      actions={
        <SettingsCommitActions
          dirty={modelDirty}
          disabled={disabled}
          onRevert={onRevert}
          onSave={onSave}
          saving={saving}
        />
      }
    >
      <div className="flex items-center gap-2">
        <InputGroup className="flex-1">
          <InputGroupAddon align="inline-start">
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search listed models"
            value={modelFilter}
            onChange={(event) => onModelFilterChange(event.target.value)}
            placeholder="Search listed models…"
            disabled={disabled || listedModels.length === 0}
          />
        </InputGroup>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={openAddDialog}
        >
          <Plus data-icon="inline-start" />
          Add models
        </Button>
      </div>

      <div className="flex flex-col gap-3" data-testid="runtime-models-list">
        {emptyMessage ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="px-1 text-center text-xs text-pretty text-muted-foreground">
              {emptyMessage}
            </p>
            {!normalizedFilter ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={openAddDialog}
              >
                <Plus data-icon="inline-start" />
                Add models
              </Button>
            ) : null}
          </div>
        ) : (
          groupedListed.map(([provider, models]) => (
            <div key={provider} className="flex flex-col gap-1.5">
              <div className="px-1 text-xs font-medium text-muted-foreground">
                {formatProviderLabel(provider)}
              </div>
              {models.map((model) => (
                <ItemRow
                  key={model.id}
                  icon={<ProviderBrandIcon provider={model.provider} />}
                  title={model.name}
                  subtitle={`${formatProviderLabel(model.provider)} · ${model.modelId}`}
                  trailing={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        HIT_AREA_EXPAND_DENSE_CLASS,
                        "h-7 px-2 text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 hover:text-destructive active:scale-[0.96]"
                      )}
                      disabled={disabled}
                      aria-label={`Remove ${model.name}`}
                      onClick={() => onRemoveModel(model)}
                    >
                      <Trash2 data-icon="inline-start" />
                      Remove
                    </Button>
                  }
                />
              ))}
            </div>
          ))
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add models</DialogTitle>
            <DialogDescription>
              Pick models discovered from your configured providers. For OpenAI
              Chat Completions, refresh runs{" "}
              <span className="font-medium">GET {"{baseUrl}/models"}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1.5">
            {discoverableProviders.map((providerId) => {
              const discovering = discoveringProviderId === providerId
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
                  {formatProviderLabel(providerId)}
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
              value={addFilter}
              onChange={(event) => setAddFilter(event.target.value)}
              placeholder="Search discovered models…"
            />
          </InputGroup>

          <div className="max-h-72 overflow-y-auto">
            {groupedCandidates.length === 0 ? (
              <p className="py-6 text-center text-xs text-pretty text-muted-foreground">
                {candidateModels.length === 0 && !normalizedAddFilter
                  ? "All discovered models are already in your list, or none are available yet."
                  : "No models match your search."}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {groupedCandidates.map(([provider, models]) => (
                  <div key={provider} className="flex flex-col gap-1">
                    <div className="px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      {formatProviderLabel(provider)}
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
              onClick={() => setAddOpen(false)}
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
    </SettingsPane>
  )
}
