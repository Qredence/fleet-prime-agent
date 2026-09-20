"use client";

import { type ComponentProps, lazy, memo, type ReactNode, Suspense, useId, useState } from "react";
import { ComposerSelectorTrigger } from "@/components/chat/composer/input/composer-selector-trigger";
import { Popover } from "@/components/chat/composer/input/input-popover";
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
	const popupId = useId();
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

	const trigger = (
		<ComposerSelectorTrigger
			ariaLabel={modelAriaLabel}
			label={modelName}
			leadingIcon={selectedModel?.icon}
			suffix={
				effortName ? <span className="hidden shrink-0 text-foreground/70 xl:inline">· {effortName}</span> : null
			}
			open={open}
			combobox
			popupId={popupId}
			className={className}
		/>
	);

	return (
		<Popover
			contentId={popupId}
			open={open}
			onOpenChange={handleOpenChange}
			side="top"
			align="start"
			className={cn("w-[min(24rem,calc(100vw-2rem))] max-h-[min(55vh,28rem)] overflow-hidden p-0", contentClassName)}
			trigger={trigger}
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
		</Popover>
	);
});
