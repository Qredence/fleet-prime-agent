// @generated — do not edit

import type { PromptSpec } from "@openuidev/lang-core";

export const openUIPromptSpec = {
	components: {
		Root: {
			signature: "Root(children?: any)",
			description: "The root container for the generated UI. Must be used as the top-level component.",
		},
		Stack: {
			signature: 'Stack(children?: any, direction?: "row" | "column", gap?: "sm" | "md" | "lg" | "xl")',
			description: "A flexbox layout component for stacking children vertically or horizontally.",
		},
		Grid: {
			signature: 'Grid(children?: any, cols?: number, gap?: "sm" | "md" | "lg" | "xl")',
			description: "A CSS grid layout component.",
		},
		Group: {
			signature: 'Group(children?: any, gap?: "sm" | "md" | "lg" | "xl")',
			description: "A wrapping horizontal group for badges, buttons, or short items.",
		},
		Divider: {
			signature: "Divider(label?: string)",
			description: "Horizontal divider with an optional label.",
		},
		Heading: {
			signature: "Heading(text: string, level?: number)",
			description: "Section heading text.",
		},
		Text: {
			signature:
				'Text(text: string, tone?: "default" | "muted" | "success" | "warning" | "danger", size?: "sm" | "md" | "lg")',
			description: "Short body text for cards, captions, and summaries.",
		},
		Button: {
			signature:
				'Button(label: string, action?: any, variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link")',
			description: "A button that triggers interactive actions or conversational updates.",
		},
		Input: {
			signature:
				'Input(name: string, value: $binding<string>, placeholder?: string, type?: "text" | "email" | "number" | "password" | "search", disabled?: boolean)',
			description: "An interactive, state-bound text input.",
		},
		Card: {
			signature:
				'Card(title: string, content?: any, tone?: "default" | "info" | "success" | "warning" | "danger", width?: "compact" | "normal" | "wide" | "full")',
			description: "A chat-sized card container for structured information.",
		},
		Badge: {
			signature: 'Badge(label: string, tone?: "default" | "info" | "success" | "warning" | "danger")',
			description: "Small status badge.",
		},
		Callout: {
			signature:
				'Callout(title: string, content?: any, tone?: "default" | "info" | "success" | "warning" | "danger")',
			description: "Highlighted note, warning, success, or error message.",
		},
		KeyValue: {
			signature: "KeyValue(label: string, value: string)",
			description: "A single label/value row.",
		},
		Metric: {
			signature:
				'Metric(label: string, value: string, trend?: string, tone?: "default" | "info" | "success" | "warning" | "danger")',
			description: "A compact KPI metric card.",
		},
		ProgressBar: {
			signature: "ProgressBar(label: string, value: number)",
			description: "Progress indicator with a label.",
		},
		List: {
			signature: "List(items: string[], ordered?: boolean)",
			description: "Bulleted or numbered text list.",
		},
		CodeBlock: {
			signature: "CodeBlock(code: string, language?: string)",
			description: "Short preformatted code or command output.",
		},
		Table: {
			signature: "Table(columns: string[], rows: string[][])",
			description: "Small data table for comparisons and summaries.",
		},
		BarChart: {
			signature:
				"BarChart(title: string, description?: string, xAxisKey: string, series: {dataKey: string, label: string}[], data: Record<string, string | number>[])",
			description: "A bar chart for visualizing comparisons or trends using explicitly provided data points.",
		},
		Select: {
			signature:
				"Select(name: string, value: $binding<string>, options: {value: string, label: string, disabled?: boolean}[], placeholder?: string)",
			description: "An interactive dropdown selector with reactive state binding.",
		},
		Switch: {
			signature: "Switch(name: string, checked: $binding<boolean>, label?: string, disabled?: boolean)",
			description: "A toggle switch component bound to a boolean reactive state.",
		},
		Modal: {
			signature: "Modal(name: string, open: $binding<boolean>, title: string, content?: any)",
			description: "An overlay dialog container bound to a boolean reactive state.",
		},
	},
} as PromptSpec;
