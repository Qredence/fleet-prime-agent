import type { ChatPiSettings } from "@prime-agent/web-protocol/chat-protocol";
import { Plus, Search, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AddModelsDialog } from "@/components/settings/providers/add-models-dialog";
import { ProviderBrandIcon } from "@/components/settings/providers/provider-brand-icon";
import { SettingsCommitActions, SettingsPane } from "@/components/settings/settings-pane";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { isModelEnabled } from "@/lib/settings/model-patterns";
import { formatProviderLabel } from "@/lib/settings/provider-metadata";
import type { ConfigModelInfo } from "@/lib/settings/types";

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
	onSetDefaultModel,
	onRevert,
	onSave,
	providers,
	saving,
	settingsLoading,
}: {
	draft: ChatPiSettings | null;
	discoveringProviderId: string | null;
	modelDirty: boolean;
	modelFilter: string;
	modelOptions: Array<ConfigModelInfo>;
	onAddModels: (models: Array<ConfigModelInfo>) => void;
	onDiscoverProvider: (providerId: string) => Promise<void>;
	onModelFilterChange: (value: string) => void;
	onRemoveModel: (model: ConfigModelInfo) => void;
	onSetDefaultModel?: (model: ConfigModelInfo) => void;
	onRevert: () => void;
	onSave: () => void;
	providers: Array<{ id: string; isConfigured: boolean; discoverable?: boolean; name?: string; displayName?: string }>;
	saving: boolean;
	settingsLoading: boolean;
}) {
	const [addOpen, setAddOpen] = useState(false);
	const disabled = !draft || settingsLoading;
	const normalizedFilter = modelFilter.trim().toLowerCase();

	const configuredProviderIds = useMemo(() => {
		// Trust the server (prime-agent-driven /api/chat/providers). Anything it
		// reports as configured is candidate visibility for the model-defaults
		// section — including custom providers like `modal` from models.json.
		const ids = new Set<string>();
		for (const provider of providers) {
			if (provider.isConfigured) {
				ids.add(provider.id);
			}
		}
		// Keep providers already on the curated list discoverable after refresh.
		for (const model of modelOptions) {
			if (isModelEnabled(model, draft?.enabledModels)) {
				ids.add(model.provider);
			}
		}
		return ids;
	}, [draft?.enabledModels, modelOptions, providers]);

	const discoverableProviderIds = useMemo(() => {
		const ids = new Set<string>();
		for (const provider of providers) {
			if (provider.discoverable === true && configuredProviderIds.has(provider.id)) {
				ids.add(provider.id);
			}
		}
		return ids;
	}, [configuredProviderIds, providers]);

	const isDefaultModel = useMemo(() => {
		return (model: ConfigModelInfo) =>
			!!draft?.defaultProvider &&
			!!draft?.defaultModel &&
			model.provider === draft.defaultProvider &&
			model.modelId === draft.defaultModel;
	}, [draft]);

	/** Preferred labels for custom/OCC instances, falling back to the catalog. */
	const providerLabel = useMemo(() => {
		const labels = new Map<string, string>();
		for (const provider of providers) {
			if (provider.displayName || provider.name) {
				labels.set(provider.id, provider.displayName ?? provider.name ?? provider.id);
			}
		}
		return (providerId: string) => labels.get(providerId) ?? formatProviderLabel(providerId);
	}, [providers]);

	const listedModels = useMemo(() => {
		return modelOptions.filter((model) => {
			if (!isModelEnabled(model, draft?.enabledModels)) return false;
			if (!normalizedFilter) return true;
			return [model.name, model.modelId, model.provider, model.id]
				.join(" ")
				.toLowerCase()
				.includes(normalizedFilter);
		});
	}, [draft?.enabledModels, modelOptions, normalizedFilter]);

	const groupedListed = useMemo(() => {
		const groups = new Map<string, Array<ConfigModelInfo>>();
		for (const model of listedModels) {
			const existing = groups.get(model.provider);
			if (existing) existing.push(model);
			else groups.set(model.provider, [model]);
		}
		return [...groups.entries()];
	}, [listedModels]);

	const emptyMessage = (() => {
		if (modelOptions.length === 0) {
			return "No models discovered yet. Configure a provider, then add models.";
		}
		if (listedModels.length === 0 && !normalizedFilter) {
			return "Add models from your configured providers to make them available in chat.";
		}
		if (listedModels.length === 0) {
			return "No models match your search.";
		}
		return null;
	})();

	const openAddDialog = () => {
		setAddOpen(true);
	};

	return (
		<SettingsPane
			title="LLM Models"
			description={
				<>
					Models available in chat. <span className="tabular-nums">{listedModels.length}</span> in list
					{modelOptions.length > 0 ? (
						<>
							{" "}
							· <span className="tabular-nums">{modelOptions.length}</span> discovered
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
				<Button type="button" variant="outline" size="compact" disabled={disabled} onClick={openAddDialog}>
					<Plus data-icon="inline-start" />
					Add models
				</Button>
			</div>

			<div className="flex flex-col gap-3" data-testid="runtime-models-list">
				{emptyMessage ? (
					<div className="flex flex-col items-center gap-3 py-8">
						<p className="px-1 text-center text-xs text-pretty text-muted-foreground">{emptyMessage}</p>
						{!normalizedFilter ? (
							<Button type="button" variant="outline" size="compact" disabled={disabled} onClick={openAddDialog}>
								<Plus data-icon="inline-start" />
								Add models
							</Button>
						) : null}
					</div>
				) : (
					groupedListed.map(([provider, models]) => (
						<div key={provider} className="flex flex-col gap-1.5">
							<div className="px-1 text-xs font-medium text-muted-foreground">{providerLabel(provider)}</div>
							{models.map((model) => (
								<Item
									key={model.id}
									variant="outline"
									size="sm"
									className="flex-nowrap gap-3 rounded-lg border-border/50 bg-muted/20 px-2.5 py-2"
								>
									<ItemMedia className="size-8 shrink-0 rounded-md border border-border/40 bg-background/60 text-foreground/70">
										<ProviderBrandIcon provider={model.provider} />
									</ItemMedia>
									<ItemContent className="min-w-0 gap-0.5">
										<ItemTitle className="w-full truncate text-sm font-medium text-foreground">
											{model.name}
										</ItemTitle>
										<ItemDescription className="truncate text-xs text-muted-foreground">
											{`${providerLabel(model.provider)} · ${model.modelId}`}
										</ItemDescription>
									</ItemContent>
									<ItemActions className="shrink-0">
										<div className="flex items-center">
											{isDefaultModel(model) ? (
												<span className="px-2 text-xs font-medium text-muted-foreground">Default</span>
											) : onSetDefaultModel ? (
												<Button
													type="button"
													variant="ghost"
													size="compact"
													className="hit-area-expand-dense h-7 px-2 text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 active:scale-[0.96]"
													disabled={disabled}
													aria-label={`Set ${model.name} as default`}
													onClick={() => onSetDefaultModel(model)}
												>
													<Star data-icon="inline-start" />
													Set default
												</Button>
											) : null}
											<Button
												type="button"
												variant="ghost"
												size="compact"
												className="hit-area-expand-dense h-7 px-2 text-xs text-muted-foreground transition-[background-color,color,transform] duration-150 hover:text-destructive active:scale-[0.96]"
												disabled={disabled}
												aria-label={`Remove ${model.name}`}
												onClick={() => onRemoveModel(model)}
											>
												<Trash2 data-icon="inline-start" />
												Remove
											</Button>
										</div>
									</ItemActions>
								</Item>
							))}
						</div>
					))
				)}
			</div>

			<AddModelsDialog
				open={addOpen}
				configuredProviderIds={configuredProviderIds}
				discoverableProviderIds={discoverableProviderIds}
				discoveringProviderId={discoveringProviderId}
				enabledModels={draft?.enabledModels}
				modelOptions={modelOptions}
				onAddModels={onAddModels}
				onDiscoverProvider={onDiscoverProvider}
				onOpenChange={setAddOpen}
				providerLabel={providerLabel}
			/>
		</SettingsPane>
	);
}
