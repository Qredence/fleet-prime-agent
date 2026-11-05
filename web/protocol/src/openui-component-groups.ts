/**
 * Prompt sections for the OpenUI component catalog.
 *
 * The library and the generated prompt spec both need this list. It lives here
 * so the two call sites share one definition instead of copying the catalog.
 */
export const openUIComponentGroups = [
	{
		name: "Layout",
		components: ["Root", "Stack", "Grid", "Group", "Divider", "Tabs", "Accordion"],
		notes: [
			"Start every program with root = Root([...]).",
			"Prefer Stack for a single axis, Grid only when the columns genuinely align.",
		],
	},
	{
		name: "Text & status",
		components: ["Heading", "Text", "Badge", "Callout", "Empty", "Skeleton"],
		notes: ["Use Callout for warnings and outcomes, Badge for compact state, Empty for a real zero-result state."],
	},
	{
		name: "Data display",
		components: ["Metric", "MetricGroup", "KeyValue", "KeyValueList", "Table", "DataTable", "List", "Steps", "Todo"],
		notes: [
			"DataTable formats typed columns (number, currency, percent); Table is for plain strings.",
			"MetricGroup is for a row of KPIs. Steps is ordered progress; Todo is a task checklist.",
		],
	},
	{
		name: "Charts",
		components: ["LineChart", "BarChart", "DonutChart"],
		notes: ["Use charts only for real series data. Never invent trend numbers just to fill a chart."],
	},
	{
		name: "Input",
		components: ["Input", "TextArea", "Select", "Switch", "Slider", "Button"],
		notes: ["Bind interactive fields to a $variable and reuse that variable in Query args so the data refetches."],
	},
	{
		name: "Containers",
		components: ["Card", "Modal", "Disclosure"],
		notes: ["Card is the default chat-sized container; Modal needs a $variable bound to its open state."],
	},
	{
		name: "Media & artifacts",
		components: ["Image", "Citation", "CodeBlock", "HtmlArtifact", "PanelAction"],
		notes: [
			"Citation is for external sources only. PanelAction opens a Fleet panel and never fetches data.",
			"HtmlArtifact is a single self-contained document, not a general layout escape hatch.",
		],
	},
];
