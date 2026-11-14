"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const SUGGESTION_ITEM_CLASS =
	"h-auto justify-start rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-pretty text-sm font-normal text-foreground/65 shadow-sm transition-colors hover:border-border hover:bg-foreground/6 hover:text-foreground";

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
				<Button
					key={suggestion}
					type="button"
					variant="outline"
					size="compact"
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
				</Button>
			))}
		</div>
	);
}
