import { createCn } from "cn/config";

/**
 * Joins conditional class values and resolves conflicting Tailwind utilities.
 *
 * Treats Fleet's micro, caption, label, body, title, headline, and display
 * `text-*` classes as font-size utilities so text-color classes can coexist.
 */
export const cn = createCn({
	extend: {
		classGroups: {
			"font-size": [{ text: ["micro", "caption", "label", "body", "title", "headline", "display"] }],
		},
	},
});
