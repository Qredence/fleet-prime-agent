import { createCn } from "cn/config";

// Register the Fleet Pi typography tokens (globals.css `--text-label`,
// `--text-body`, `--text-title`, `--text-headline`, `--text-display`) as
// font-size utilities. Without this, class merging classifies unknown
// bare `text-*` values as colors and drops e.g. `text-label` when a
// `text-foreground/*` color class appears in the same merge.
export const cn = createCn({
	extend: {
		classGroups: {
			"font-size": [{ text: ["micro", "caption", "label", "body", "title", "headline", "display"] }],
		},
	},
});
