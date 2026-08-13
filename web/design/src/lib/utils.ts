import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Register the Fleet Pi typography tokens (globals.css `--text-label`,
// `--text-body`, `--text-title`, `--text-headline`, `--text-display`) as
// font-size utilities. Without this, tailwind-merge classifies unknown
// bare `text-*` values as colors and drops e.g. `text-label` when a
// `text-foreground/*` color class appears in the same merge.
const twMergeExtended = extendTailwindMerge({
	extend: {
		classGroups: {
			"font-size": [{ text: ["label", "body", "title", "headline", "display"] }],
		},
	},
});

export function cn(...inputs: Array<ClassValue>) {
	return twMergeExtended(clsx(inputs));
}
