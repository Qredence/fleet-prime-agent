"use client";

import type { ComponentProps } from "react";
import { SUGGESTION_ITEM_CLASS } from "@/components/layout/tokens";
import { cn } from "@/lib/utils";

export interface PromptSuggestionsProps extends Omit<ComponentProps<"div">, "children"> {
	suggestions: readonly string[];
	selectedSuggestion: string | null;
	cycle: number;
	onSuggestion: (suggestion: string) => void;
	variant?: "pills" | "list";
}

export function PromptSuggestions({
	suggestions,
	selectedSuggestion,
	cycle,
	onSuggestion,
	variant = "pills",
	className,
	...props
}: PromptSuggestionsProps) {
	const list = variant === "list";

	return (
		<div
			data-slot="suggestions"
			key={cycle}
			className={cn(
				list ? "flex w-full max-w-sm flex-col gap-2" : "flex w-full max-w-chat flex-wrap justify-center gap-1.5",
				className,
			)}
			{...props}
		>
			{suggestions.map((suggestion, index) => (
				<button
					key={suggestion}
					type="button"
					aria-pressed={selectedSuggestion === suggestion}
					onClick={() => onSuggestion(suggestion)}
					className={cn(
						SUGGESTION_ITEM_CLASS,
						"fade-in slide-in-from-bottom-2 animate-in fill-mode-both cursor-pointer focus-visible:ring-2 focus-visible:ring-ring motion-reduce:animate-none",
						list && "w-full justify-start rounded-2xl px-4 py-2.5 text-start",
						selectedSuggestion === suggestion &&
							"!bg-foreground !text-background hover:!text-background focus-visible:!text-background",
					)}
					style={{ animationDelay: `${index * 70}ms` }}
				>
					{suggestion}
				</button>
			))}
		</div>
	);
}
