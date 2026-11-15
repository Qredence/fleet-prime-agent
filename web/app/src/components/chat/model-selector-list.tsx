"use client";

import { Check } from "lucide-react";
import { useMemo } from "react";
import type { ModelSelectorEffort, ModelSelectorModel } from "@/components/chat/model-selector";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Slider } from "@/components/ui/slider";
import { useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

export interface ModelSelectorListProps {
	models: readonly ModelSelectorModel[];
	selectedModel: ModelSelectorModel | undefined;
	selectedEffort: ModelSelectorEffort | undefined;
	effortLabel: string;
	onModelChange?: (modelId: string) => void;
	onEffortChange?: (effortId: string) => void;
}

/**
 * Groups models by provider for organized display in the selector list.
 *
 * @param models - Models to group by their provider property
 * @returns Array of tuples containing provider name and its associated models
 */
function groupModels(models: readonly ModelSelectorModel[]) {
	const groups = new Map<string, ModelSelectorModel[]>();
	for (const model of models) {
		const group = groups.get(model.provider) ?? [];
		group.push(model);
		groups.set(model.provider, group);
	}
	return [...groups.entries()];
}

/**
 * Searchable text for a model item. Doubles as the cmdk item value, so the
 * same string passed to `Command value` highlights the selected model and
 * scrolls it into view when the picker opens.
 *
 * @param model - Model to build the search value for
 * @returns Space-joined id/name/provider/keyword string
 */
function modelSearchValue(model: ModelSelectorModel) {
	return [model.id, model.name, model.provider, model.providerLabel, model.modelId, ...(model.keywords ?? [])]
		.filter(Boolean)
		.join(" ");
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
	const groups = useMemo(() => groupModels(models), [models]);
	const { type } = useSize();

	return (
		<Command
			className="min-h-0 max-h-[min(55dvh,28rem)] bg-transparent"
			shouldFilter
			value={selectedModel ? modelSearchValue(selectedModel) : undefined}
		>
			<CommandInput placeholder="Search models…" aria-label="Search models" />
			<CommandList className="max-h-48 min-h-0 flex-1 p-1.5">
				<CommandEmpty>
					{models.length === 0
						? "No models added yet. Add models in Settings → LLM Models."
						: "No matching models"}
				</CommandEmpty>
				{groups.map(([provider, providerModels]) => (
					<CommandGroup key={provider} heading={providerModels[0]?.providerLabel ?? provider}>
						{providerModels.map((model) => {
							const selected = model.id === selectedModel?.id;
							return (
								<CommandItem
									key={model.id}
									value={modelSearchValue(model)}
									disabled={model.disabled}
									onSelect={() => {
										if (model.disabled) return;
										onModelChange?.(model.id);
									}}
									className="items-center gap-2 rounded-md px-2.5 py-2"
								>
									<span className={cn("min-w-0 flex-1 font-medium", type.body)}>{model.name}</span>
									{selected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
								</CommandItem>
							);
						})}
					</CommandGroup>
				))}
			</CommandList>
			{selectedModel?.reasoning && selectedModel.efforts?.length ? (
				<div className="shrink-0 border-t border-border/70 p-2">
					<Slider
						label={effortLabel}
						value={Math.max(
							0,
							selectedModel.efforts.findIndex((option) => option.id === selectedEffort?.id),
						)}
						onChange={(nextValue) => {
							const option = selectedModel.efforts?.[Math.round(nextValue)];
							if (option && !option.disabled) onEffortChange?.(option.id);
						}}
						min={0}
						max={Math.max(0, selectedModel.efforts.length - 1)}
						formatValue={(nextValue) => selectedModel.efforts?.[Math.round(nextValue)]?.name ?? ""}
						className="[&_.bg-background]:bg-popover"
					/>
				</div>
			) : null}
		</Command>
	);
}
