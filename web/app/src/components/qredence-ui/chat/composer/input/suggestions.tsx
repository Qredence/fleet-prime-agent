import type { ReactNode } from "react";

export type SuggestionItem = {
	id: string;
	label: string;
	value?: string;
	icon?: ReactNode;
	description?: string;
	category?: string;
	keywords?: readonly string[];
	disabled?: boolean;
	metadata?: Record<string, string | undefined>;
	className?: string;
};
