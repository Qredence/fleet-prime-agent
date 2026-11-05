// Frozen 0.x component signatures from the last pre-1.x Fleet client.
// Do not generate this compatibility prompt with the 1.x prompt generator.
import type { OpenUIPromptMode } from "./openui-prompt";

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
	"Use `PanelAction` only to open Resources, Workspace, Artifacts, or Session insights. Use a workspace-relative path only when selecting a Workspace or Artifact location; it cannot change the workspace root or access external paths.",
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

const ARTIFACT_RULES = [
	"This is an OpenUI artifact request. Use the available tools as needed, then return exactly one fenced `openui` program and no prose before or after it.",
	'The program must have `root = Root([...])` and exactly one `HtmlArtifact("title", "document")` component under that root.',
	"The HtmlArtifact document must be a complete, self-contained HTML visualization with inline CSS and inline JavaScript only. Do not use Mermaid, Markdown text blocks, external URLs, network APIs, forms, popups, downloads, event-handler attributes, external scripts, styles, frames, or images.",
	"Encode the HTML as a valid OpenUI string argument. Prefer HTML/SVG/CSS for architecture diagrams and keep the title short.",
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
root = Root([form])
$timeframe = "7"
$advanced = false
$searchQuery = ""
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

export function buildLegacyOpenUIPrompt(mode: OpenUIPromptMode, options?: { artifact?: boolean }) {
	const additionalRules = options?.artifact
		? [...BASE_RULES, ...ARTIFACT_RULES]
		: [...BASE_RULES, ...(mode === "plan" ? PLAN_RULES : AGENT_RULES)];

	return [OPENUI_PREAMBLE, ...additionalRules, "Component signatures:", LEGACY_SIGNATURES, ...EXAMPLES].join("\n\n");
}

const LEGACY_SIGNATURES = [
	"Root(children?: any) \u2014 The root container for the generated UI. Must be used as the top-level component.",
	'Stack(children?: any, direction?: "row" | "column", gap?: "sm" | "md" | "lg" | "xl") \u2014 A flexbox layout component for stacking children vertically or horizontally.',
	'Grid(children?: any, cols?: number, gap?: "sm" | "md" | "lg" | "xl") \u2014 A CSS grid layout component.',
	'Group(children?: any, gap?: "sm" | "md" | "lg" | "xl") \u2014 A wrapping horizontal group for badges, buttons, or short items.',
	"Divider(label?: string) \u2014 Horizontal divider with an optional label.",
	"Heading(text: string, level?: number) \u2014 Section heading text.",
	'Text(text: string, tone?: "default" | "muted" | "success" | "warning" | "danger", size?: "sm" | "md" | "lg") \u2014 Short body text for cards, captions, and summaries.',
	'Button(label: string, action?: any, variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link") \u2014 A button that triggers interactive actions or conversational updates.',
	'PanelAction(label: string, panel: "resources" | "workspace" | "artifacts" | "repl" | "subagents" | "session-insights" | "session-tree", relativePath?: any, focus?: boolean) \u2014 A trusted local action that opens Resources, Workspace, Artifacts, REPL, Subagents, Session insights, or Session tree. relativePath selects a contained workspace-relative path and is valid only for Workspace and Artifacts panels.',
	'Input(name: string, value: $binding<string>, placeholder?: string, type?: "text" | "email" | "number" | "password" | "search", disabled?: boolean) \u2014 An interactive, state-bound text input.',
	'Card(title: string, content?: any, tone?: "default" | "info" | "success" | "warning" | "danger", width?: "compact" | "normal" | "wide" | "full") \u2014 A chat-sized card container for structured information.',
	'Badge(label: string, tone?: "default" | "info" | "success" | "warning" | "danger") \u2014 Small status badge.',
	'Callout(title: string, content?: any, tone?: "default" | "info" | "success" | "warning" | "danger") \u2014 Highlighted note, warning, success, or error message.',
	"KeyValue(label: string, value: string) \u2014 A single label/value row.",
	'Metric(label: string, value: string, trend?: string, tone?: "default" | "info" | "success" | "warning" | "danger") \u2014 A compact KPI metric card.',
	"ProgressBar(label: string, value: number) \u2014 Progress indicator with a label.",
	"List(items: string[], ordered?: boolean) \u2014 Bulleted or numbered text list.",
	"CodeBlock(code: string, language?: string) \u2014 Short preformatted code or command output.",
	"Table(columns: string[], rows: string[][]) \u2014 Small data table for comparisons and summaries.",
	"BarChart(title: string, description?: string, xAxisKey: string, series: {dataKey: string, label: string}[], data: Record<string, string | number>[]) \u2014 A bar chart for visualizing comparisons or trends using explicitly provided data points.",
	"LineChart(title: string, description?: string, xAxisKey: string, series: {dataKey: string, label: string, color?: string}[], data: Record<string, string | number>[]) \u2014 A line chart for trends over time or ordered categories.",
	"DonutChart(title: string, description?: string, segments: {label: string, value: number, color?: string}[], centerLabel?: string) \u2014 A donut/pie chart for part-of-whole composition.",
	'DataTable(title?: string, columns: {key: string, label: string, type?: "text" | "number" | "currency" | "percent", align?: "left" | "right"}[], rows: Record<string, string | number>[]) \u2014 A data table with typed columns (text, number, currency, percent), formatted values, and click-to-sort headers.',
	'MetricGroup(metrics: {label: string, value: string, delta?: string, deltaTone?: "up" | "down" | "neutral", sparkline?: number[]}[]) \u2014 A compact group of KPI cards with optional deltas and trend sparklines.',
	"Select(name: string, value: $binding<string>, options: {value: string, label: string, disabled?: boolean}[], placeholder?: string) \u2014 An interactive dropdown selector with reactive state binding.",
	"Switch(name: string, checked: $binding<boolean>, label?: string, disabled?: boolean) \u2014 A toggle switch component bound to a boolean reactive state.",
	"Modal(name: string, open: $binding<boolean>, title: string, content?: any) \u2014 An overlay dialog container bound to a boolean reactive state.",
	"Disclosure(title: string, content?: any, open?: boolean) \u2014 A compact progressive-disclosure section for optional details.",
	'Todo(title?: string, items: {label: string, status?: "pending" | "in-progress" | "completed" | "cancelled", detail?: string}[]) \u2014 A read-only progress list for plans and task status.',
	"Citation(title: string, url: string, domain?: string) \u2014 A safe external source citation rendered as a link.",
	"HtmlArtifact(title: string, document: string) \u2014 A durable, self-contained HTML artifact rendered in a sandboxed preview.",
].join("\n");
