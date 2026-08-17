import { generatePrompt } from "@openuidev/lang-core";

import { openUIPromptSpec } from "./openui-signatures";

export type OpenUIPromptMode = "agent" | "harness" | "plan" | "plan-execution";

const OPENUI_PREAMBLE = "You are an AI assistant that can include openui-lang blocks inside normal chat responses.";

const OPENUI_FENCE_RULE =
	"When rendering generative UI inline, wrap the OpenUI Lang program in a fenced ```openui code block. Do not make the entire response OpenUI unless the user explicitly asks for only UI.";

const BASE_RULES = [
	OPENUI_FENCE_RULE,
	"Every OpenUI block must start with `root = Root(...)` as its first line.",
	"Use only the components listed in the generated component signatures; never invent component names or named arguments.",
	'Arguments are positional. For example, write `Card("Title", child)` rather than `Card(title: "Title", content: child)`.',
	"Use Markdown for prose, explanations, and code unless a visual card, table, metric, chart, or action row would be clearer.",
	"Prefer compact UI blocks that fit inside a chat message.",
	"Use Todo for read-only Prime plans and task progress, Disclosure for optional detail, and Citation for ordinary external sources.",
	"Use `PanelAction` only to open Resources, Workspace, or Artifacts and only with a workspace-relative path. It cannot change the workspace root or access external paths.",
	"Citation links are external references only; never use them to access local files or trigger host actions.",
	"Do not use `Button` for application navigation, settings, tabs, tool execution, or approvals.",
	'Reactive State ($variables): Declare reactive variables with `$name = defaultValue`. Bind them to inputs such as `Input("search", $search)` or `Select("timeframe", $timeframe, [{ value: "7", label: "7 Days" }])`. Updating the input automatically recalculates all dependent expressions.',
	"Built-in Functions: Use @-prefixed functions for data transformation: `@Count(array)`, `@Sum(numbers[])`, `@Avg(numbers[])`, `@Filter(array, field, op, value)`. Bare names without @ are not supported.",
	'Action Compositions: Chained actions can be defined inside `Action([...])`. For example: `Button("Submit", Action([@Run(myMutation), @Set($success, true), @Reset($inp)]))`. Steps execute sequentially; failure in any step aborts the rest.',
];

const PLAN_RULES = [
	"In Plan mode, keep the numbered plan in Markdown. Use OpenUI only for optional visual summaries, status cards, or small decision aids.",
	"Do not use OpenUI actions in Plan mode.",
];

const AGENT_RULES = [
	"Use OpenUI for dashboards, structured comparisons, progress/status summaries, result cards, metrics, and interactive forms.",
	"Buttons may trigger conversational messages or complex action compositions; do not use them for destructive actions.",
];

const EXAMPLES = [
	`A compact status summary:
\`\`\`openui
root = Root([summary])
summary = Card("OpenUI status", Stack([ok, next]))
ok = Badge("Renderer wired", "success")
next = Text("Next: validate streamed fenced blocks.", "muted")
\`\`\``,
	`An interactive settings form with reactive bindings and actions:
\`\`\`openui
$timeframe = "7"
$advanced = false
$searchQuery = ""

root = Root([form])
form = Card("Dashboard Controls", Stack([search, row, submit]))
search = Input("search", $searchQuery, "Search records...")
row = Stack([timeframeSelect, advancedToggle], "row")
timeframeSelect = Select("timeframe", $timeframe, [
  { value: "7", label: "Last 7 Days" },
  { value: "30", label: "Last 30 Days" },
])
advancedToggle = Switch("advanced", $advanced, "Show advanced diagnostics")

submit = Button("Apply Filters", Action([@Set($searchQuery, ""), @ToAssistant("Applying search filters")]))
\`\`\``,
];

export function buildOpenUIPrompt(mode: OpenUIPromptMode) {
	const additionalRules = [...BASE_RULES, ...(mode === "plan" ? PLAN_RULES : AGENT_RULES)];

	return generatePrompt({
		...openUIPromptSpec,
		preamble: OPENUI_PREAMBLE,
		additionalRules,
		examples: EXAMPLES,
		bindings: true,
		toolCalls: mode === "agent" || mode === "plan-execution",
		editMode: false,
	});
}
