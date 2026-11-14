"use client";

import { type ComponentProps, lazy, memo, type ReactNode, Suspense, useState } from "react";
import { ChevronDown } from "lucide-react";
import { COMPOSER_SELECTOR_TRIGGER_CLASS } from "@/components/chat/composer/composer-controls";
import { InputGroupButton } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const LazyModelSelectorList = lazy(() =>
	import("@/components/chat/model-selector-list").then(({ ModelSelectorList }) => ({
		default: ModelSelectorList,
	})),
);

/**
 * Lazy-loaded wrapper for the model selector list that displays a loading
 * skeleton while the cmdk dependency loads.
 *
 * @param props - Props forwarded to the ModelSelectorList component
 * @returns Suspense-wrapped ModelSelectorList with loading fallback
 */
function ModelSelectorList(props: ComponentProps<typeof LazyModelSelectorList>) {
	return (
		<Suspense
			fallback={
				<div
					className="h-24 animate-pulse rounded-md bg-muted/40 p-1.5"
					aria-label="Loading models"
					role="status"
				/>
			}
		>
			<LazyModelSelectorList {...props} />
		</Suspense>
	);
}

export type ModelSelectorEffort = {
	id: string;
	name: string;
	description?: string;
	disabled?: boolean;
};

export type ModelSelectorModel = {
	id: string;
	name: string;
	provider: string;
	providerLabel?: string;
	modelId?: string;
	description?: string;
	icon?: ReactNode;
	disabled?: boolean;
	reasoning?: boolean;
	efforts?: readonly ModelSelectorEffort[];
	keywords?: readonly string[];
};

export type ModelSelectorProps = {
	models: readonly ModelSelectorModel[];
	value?: string;
	effort?: string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onModelChange?: (modelId: string) => void;
	onEffortChange?: (effort: string) => void;
	placeholder?: string;
	effortLabel?: string;
	className?: string;
	contentClassName?: string;
};

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
	const [internalOpen, setInternalOpen] = useState(false);
	const open = controlledOpen ?? internalOpen;
	const handleOpenChange = (next: boolean) => {
		if (controlledOpen === undefined) setInternalOpen(next);
		onOpenChange?.(next);
	};
	const selectedModel = models.find((model) => model.id === value) ?? models[0];
	const selectedEffort = selectedModel?.efforts?.find((option) => option.id === effort) ?? selectedModel?.efforts?.[0];
	const modelName = selectedModel?.name ?? placeholder;
	const effortName = selectedEffort && selectedModel?.reasoning ? selectedEffort.name : undefined;
	const modelAriaLabel = effortName
		? `Select model and reasoning effort, ${modelName}, ${effortName}`
		: `Select model and reasoning effort, ${modelName}`;

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger
				render={
					<InputGroupButton
						role="combobox"
						variant="ghost"
						size="sm"
						aria-label={modelAriaLabel}
						title={modelName}
						className={cn(COMPOSER_SELECTOR_TRIGGER_CLASS, className)}
					>
						{selectedModel?.icon ? (
							<span aria-hidden="true" className="shrink-0 [&_svg]:size-3.5">
								{selectedModel.icon}
							</span>
						) : null}
						<span className="min-w-0 truncate font-medium">{modelName}</span>
						{effortName ? (
							<span className="hidden shrink-0 text-foreground/70 xl:inline">· {effortName}</span>
						) : null}
						<ChevronDown aria-hidden="true" className="size-3 shrink-0 text-foreground/70" />
					</InputGroupButton>
				}
			/>
			<PopoverContent
				side="top"
				align="start"
				sideOffset={6}
				className={cn(
					"w-[min(24rem,calc(100vw-2rem))] max-h-[min(55dvh,28rem)] overflow-hidden p-0",
					contentClassName,
				)}
			>
				{open ? (
					<ModelSelectorList
						models={models}
						selectedModel={selectedModel}
						selectedEffort={selectedEffort}
						effortLabel={effortLabel}
						onModelChange={onModelChange}
						onEffortChange={onEffortChange}
					/>
				) : null}
			</PopoverContent>
		</Popover>
	);
});
