import { generatePrompt } from "@openuidev/lang-core";
import { buildLegacyOpenUIPrompt } from "./openui-legacy-prompt";

import { openUIPromptSpec } from "./openui-signatures";
import { OPENUI_TOOL_DESCRIPTORS } from "./openui-tools";

export type OpenUIPromptMode = "agent" | "harness" | "plan" | "plan-execution";

export type OpenUIDashboardPrompt = {
	mode: "cloud" | "self-hosted";
	latestDashboardId?: string;
};

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
	"Use Todo for read-only Prime checklists and plan items, Steps for ordered pipeline progress, Disclosure for optional detail, and Citation for ordinary external sources.",
	"Use `PanelAction` only to open Resources, Workspace, Artifacts, or Session insights. Use a workspace-relative path only when selecting a Workspace or Artifact location; it cannot change the workspace root or access external paths.",
	"Citation links are external references only; never use them to access local files or trigger host actions.",
	"Do not use `Button` for application navigation, settings, tabs, tool execution, or approvals.",
	'Reactive State ($variables): Declare reactive variables with `$name = defaultValue`. Bind them to inputs such as `Input("search", $search)` or `Select("timeframe", $timeframe, [{ value: "7", label: "7 Days" }])`. Updating the input automatically recalculates all dependent expressions.',
	"Built-in Functions: Use @-prefixed functions for data transformation: `@Count(array)`, `@Sum(numbers[])`, `@Avg(numbers[])`, `@Filter(array, field, op, value)`. Bare names without @ are not supported.",
	'Action Compositions: Chained actions can be defined inside `Action([...])`. For example: `Button("Refresh", Action([@Run(myQuery), @Set($success, true), @Reset($inp)]))`. Steps execute sequentially; failure in any step aborts the rest.',
];

const TOOL_RULES = [
	'When live Fleet data would make the answer better, use `Query("tool_name", {args}, {rows: []})` with one of the listed tools. Queries must be top-level statements, never inline arguments.',
	"Fleet's tools are read-only. `Mutation`, write tools, and `@Run(<mutation>)` do not exist here: to change something, tell the user what to do or send a conversational message instead.",
	"Aggregate query results in the program with `@Count`, `@Filter`, `@Sum`, and `@Sort` rather than re-fetching. Bind a `$variable` in the query args when a control should refetch.",
	"DataTable and Table column keys must be field names the tool actually returns. Do not rename or invent keys to make nicer headers; put the nicer wording in the column `label`.",
	"Tabs and Steps are available components. Use Tabs for content that should switch between views, and Steps for ordered pipeline progress; do not substitute a Select or a Todo list for those.",
	"`session_stats` returns one row per status, so `@Count(stats.rows)` counts statuses, not sessions. Total the fleet with `@Sum(stats.rows.sessions)` and `@Sum(stats.rows.messages)`.",
];

const MUTATION_SECTION_HEADING = "## Mutation — Write Operations";
const MUTATION_EXAMPLE_LEAD = /Example — mutation \+ refresh \+ reset/;

/**
 * Lines upstream emits that teach or demonstrate writes. They either contain
 * runnable `Mutation(...)` code or describe the workflow the read-only surface
 * cannot fulfil, so they are dropped rather than merely reworded.
 */
const WRITE_TEACHING_LINE = /Mutation|WRITE operations|for writes/;

/** Reads-only replacements for prose that must keep its surrounding structure. */
const READ_ONLY_REWRITES: ReadonlyArray<readonly [RegExp, string]> = [
	[
		/Use these with Query\(\) for read operations or Mutation\(\) for write operations\. The LLM decides which is appropriate based on the tool's purpose\./,
		"Use these with Query() for read operations. Every tool here is read-only; there are no write tools.",
	],
	[
		/CRITICAL: Use ONLY the tools listed above in Query\(\) and Mutation\(\) calls\./,
		"CRITICAL: Use ONLY the tools listed above in Query() calls. These tools are read-only, so never emit Mutation().",
	],
];

/**
 * Upstream emits its `Mutation` documentation whenever `toolCalls` is enabled,
 * with no switch to turn writes off. Fleet's tool surface is read-only, so the
 * promise has to be removed from the text: otherwise the prompt teaches a
 * statement the renderer can only ever report as `tool-not-found`.
 *
 * The `@Run(...)` step itself stays documented, because `@Run(query)` is how a
 * button re-fetches a read-only query.
 */
export function stripMutationGuidance(prompt: string): string {
	const lines = prompt.split("\n");
	const kept: string[] = [];
	const droppedMutationRefs = new Set<string>();
	let skippingSection = false;
	let skippingExample = false;
	let fenceTicks = 0;
	let inFence = false;

	for (const line of lines) {
		const fenceMatch = /^\s*(```+)/.exec(line);
		if (fenceMatch) {
			if (!inFence) {
				inFence = true;
				fenceTicks = fenceMatch[1].length;
			} else if (fenceMatch[1].length === fenceTicks) {
				const droppingBlock = skippingExample;
				inFence = false;
				fenceTicks = 0;
				skippingExample = false;
				if (droppingBlock) continue;
			}
		}

		// A write example is a lead line plus the fenced program under it.
		if (!inFence && !skippingExample && MUTATION_EXAMPLE_LEAD.test(line)) {
			skippingExample = true;
			continue;
		}
		if (skippingExample) continue;

		if (line.startsWith(MUTATION_SECTION_HEADING)) {
			skippingSection = true;
			continue;
		}
		if (skippingSection) {
			if (line.startsWith("## ")) skippingSection = false;
			else continue;
		}

		// Remember which identifiers were defined by a Mutation, so the examples
		// that @Run them do not keep a dangling reference after the write goes.
		const mutationAssign = /^\s*([A-Za-z_$][\w$]*)\s*=\s*Mutation\(/.exec(line);
		if (mutationAssign) {
			droppedMutationRefs.add(mutationAssign[1]);
			continue;
		}
		// `@Run` is how a button re-fetches a read-only query; drop the write half.
		if (/^-\s*@Run\(ref: Query \| Mutation\)/.test(line)) {
			kept.push("- @Run(ref: Query) — Re-fetch a declared Query. A click cannot write anything.");
			continue;
		}
		// @Run stays documented for queries; only its mutation failure mode goes.
		if (/^-\s*If a @Run\(mutation\) step fails/.test(line)) continue;
		// Drop any step that would run a now-undefined mutation.
		if ([...droppedMutationRefs].some((name) => line.includes(`@Run(${name})`))) continue;
		// Upstream points at the mutation example after that example has been removed.
		if (/form \+ mutation patterns/i.test(line)) continue;

		let next = line;
		for (const [pattern, replacement] of READ_ONLY_REWRITES) next = next.replace(pattern, replacement);
		if (/Mutation/.test(next) && WRITE_TEACHING_LINE.test(next)) continue;

		kept.push(next);
	}

	return renumberOrderedList(kept)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Removing a step from a numbered list leaves a gap. Renumber only contiguous
 * `N.` runs so unrelated Markdown is untouched.
 */
function renumberOrderedList(lines: string[]): string[] {
	let counter = 0;
	return lines.map((line) => {
		const match = /^(\d+)\.\s+(.*)$/.exec(line);
		if (!match) {
			counter = 0;
			return line;
		}
		counter += 1;
		return `${counter}. ${match[2]}`;
	});
}

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

const TOOL_EXAMPLES = [
	`A session activity table fed by a Query:
\`\`\`openui
root = Root([summary, sessions])
data = Query("list_sessions", {limit: 20}, {rows: []})
summary = Card("Sessions", Stack([count, note]))
count = Text("" + @Count(@Filter(data.rows, "status", "==", "running")) + " running")
note = Text("From the last 20 sessions.", "muted")
sessions = DataTable("Recent sessions", [{ key: "title", label: "Session" }, { key: "status", label: "Status" }, { key: "messageCount", label: "Messages", type: "number" }], data.rows)
\`\`\``,
	`A tabbed dashboard whose KPIs sum the aggregate rows:
\`\`\`openui
root = Root([heading, tabs])
stats = Query("session_stats", {}, {rows: []})
heading = Heading("Fleet sessions", 2)
tabs = Tabs([{"label": "Overview", "content": kpis}, {"label": "By status", "content": detail}, {"label": "Pipeline", "content": pipeline}], 0)
kpis = MetricGroup([{ label: "Sessions", value: "" + @Sum(stats.rows.sessions) }, { label: "Messages", value: "" + @Sum(stats.rows.messages) }])
detail = DataTable("Status", [{ key: "status", label: "Status" }, { key: "sessions", label: "Sessions", type: "number" }], stats.rows)
pipeline = Steps([{"label": "Query", "state": "complete"}, {"label": "Aggregate", "state": "complete"}, {"label": "Render", "state": "current"}])
\`\`\``,
	`A KPI row that aggregates on the client instead of re-fetching:
\`\`\`openui
root = Root([kpis, detail])
stats = Query("session_stats", {}, {rows: []})
kpis = MetricGroup([{ label: "Running", value: "" + @Sum(@Filter(stats.rows, "status", "==", "running").sessions) }])
detail = DataTable("By status", [{ key: "status", label: "Status" }, { key: "sessions", label: "Sessions", type: "number" }, { key: "messages", label: "Messages", type: "number" }], stats.rows)
\`\`\``,
];

const SESSION_DASHBOARD_PROGRAM = `root = Dashboard([header, section])
$limit = "20"
outputs = Query("session_outputs", {limit: $limit}, {rows: [], columns: {}, total: 0, toolCalls: 0})
header = DashboardHeader("This session", "Live tool and text output from this session")
filterBar = FilterBar([limitFilter], [], true)
limitFilter = FilterSelect("limit", "Rows", [{ value: "20", label: "20 rows" }, { value: "40", label: "40 rows" }], $limit)
kpis = CardRow([kpiOutputs, kpiTools], "stretch")
kpiOutputs = SmallCard("Outputs", "" + outputs.total)
kpiTools = SmallCard("Tool calls", "" + outputs.toolCalls)
tableCard = LargeCard([tableHeader, table], false)
tableHeader = DashboardCardHeader("Session outputs", "Oldest first", "text")
table = Table([colTurn, colRole, colPreview])
colTurn = Col("Turn", outputs.columns.turn, "number")
colRole = Col("Role", outputs.columns.role)
colPreview = Col("Preview", outputs.columns.preview)
section = Section([kpis, tableCard], filterBar, "Activity")`;

const SESSION_DASHBOARD_EXAMPLE = `A dashboard of the open session. The select refetches the query:
\`\`\`openui-dashboard
${JSON.stringify({ title: "This session", program: SESSION_DASHBOARD_PROGRAM })}
\`\`\``;

const DASHBOARD_RULES = [
	"Dashboard programs render with the dashboard component library, whose root is Dashboard. Emit Dashboard([DashboardHeader(...), Section(...)]) and nothing else at the root. Do not use Root, Stack, MetricGroup, or DataTable: they belong to the chat library and will not render.",
	"Layout inside a Section: Section(rows, filterBar?, title?) where rows are CardRow or card values, and a card is SmallCard(title, metric, trend?), MediumCard([...]), or LargeCard([...], collapsed). Tables are column-oriented: Table([Col(label, data, type?), ...]).",
	'Col takes one column of primitive values, not rows: Col("Role", outputs.columns.role). session_outputs returns rows for counting and filtering plus a columns object holding one array per field. Passing whole row objects to Col renders blank cells, so bind each column to outputs.columns.<field>.',
	'Stated figures come from Query("dashboard_rows"). It returns columns, rows, and columnValues, one array per column key. Bind Col and charts to columnValues.<key>. Query("session_outputs") is this chat\'s own activity.',
	"Bind every number to a Query. Use outputs.total for session-wide counts and never the fetched page size. Do not bake numbers into a dashboard: it reloads its data every time it opens, so a literal goes stale while looking live.",
];

const CLOUD_DASHBOARD_RULES = [
	"Research the subject in this turn with the normal tools, and write the findings in the reply first. OpenUI only lays those findings out. It does not search, browse, or fill gaps.",
	'Then emit one fenced ```openui-dashboard block whose body is JSON {"title":"...","prompt":"...","columns":[{"key":"party","label":"Party","type":"string"},{"key":"seats","label":"Seats","type":"number"}],"rows":[{"party":"D","seats":250}]}. Fence column type is "string" or "number", not OpenUI DataTable "text", "currency", or "percent". The prompt names the sections, charts, tables, filters, and the column keys. Do not put numbers in the prompt. rows copies only figures that reply already stated, including their status. Leave a figure out when it was not stated. One fence per message.',
	"Chart Query(\"dashboard_rows\"). That tool is the rows on the fence. Use session_outputs only for a dashboard of this chat's own activity, and omit columns and rows for that dashboard. If the subject is not this chat's activity and the reply stated no figures, say so in prose and do not emit the fence.",
	'To change a dashboard, emit {"id":"<dashboard id>","prompt":"the change"} in an ```openui-dashboard block. Include columns and rows only when the figures change. Omit them to keep the stored rows. Create a new dashboard only when asked.',
];

const LOCAL_DASHBOARD_RULES = [
	"Research the subject in this turn with the normal tools, and write the findings in the reply first. The dashboard program only lays those findings out. It does not search, browse, or fill gaps.",
	'Then emit one fenced ```openui-dashboard block whose body is JSON {"title":"...","program":"...","columns":[...],"rows":[...]}. The program is a complete openui-lang dashboard written with the dashboard component library rules above. rows copies only figures that reply already stated, including their status. One fence per message.',
	'Query("dashboard_rows") serves those rows. Bind every chart and table to columnValues.<key>. Query("session_outputs") is this chat\'s own activity. Omit columns and rows for a dashboard of this chat, and bind that program to session_outputs. Do not invent rows.',
	"If the subject is not this chat's activity and the reply stated no figures, say so in prose and do not emit the fence.",
	'To change a dashboard, emit {"id":"<dashboard id>","program":"the full updated dashboard"} in an ```openui-dashboard block. Include columns and rows only when the figures change. Omit them to keep the stored rows. Create a new dashboard only when asked.',
];

export function buildOpenUIPrompt(
	mode: OpenUIPromptMode,
	options?: { artifact?: boolean; syntaxVersion?: "0.x" | "1.x"; dashboards?: OpenUIDashboardPrompt },
) {
	if (options?.syntaxVersion !== "1.x") return buildLegacyOpenUIPrompt(mode, options);
	const artifact = options?.artifact === true;
	const toolCalls = !artifact && (mode === "agent" || mode === "plan-execution");
	const cloudDashboards = options?.dashboards?.mode === "cloud";
	const dashboardRules = options?.dashboards
		? [
				...(cloudDashboards ? CLOUD_DASHBOARD_RULES : [...DASHBOARD_RULES, ...LOCAL_DASHBOARD_RULES]),
				...(options.dashboards.latestDashboardId
					? [`The latest dashboard id is ${options.dashboards.latestDashboardId}.`]
					: []),
			]
		: [];
	const additionalRules = artifact
		? [...BASE_RULES, ...ARTIFACT_RULES]
		: [
				...BASE_RULES,
				...(mode === "plan" ? PLAN_RULES : AGENT_RULES),
				...(toolCalls ? TOOL_RULES : []),
				...dashboardRules,
			];

	const prompt = generatePrompt({
		...openUIPromptSpec,
		preamble: OPENUI_PREAMBLE,
		additionalRules,
		examples: EXAMPLES,
		// Artifact responses must stay a single self-contained program, so the
		// tool surface is only advertised where the renderer can actually serve it.
		...(toolCalls
			? {
					tools: OPENUI_TOOL_DESCRIPTORS.map((tool) => ({
						name: tool.name,
						description: tool.description,
						inputSchema: tool.inputSchema,
						outputSchema: tool.outputSchema,
					})),
					// The session-dashboard example is dashboard-library grammar, so it is only
					// taught when dashboards are actually offered. Cloud is told to emit a
					// fence with a prompt, and never a program.
					toolExamples:
						!options?.dashboards || cloudDashboards
							? TOOL_EXAMPLES
							: [...TOOL_EXAMPLES, SESSION_DASHBOARD_EXAMPLE],
				}
			: {}),
		bindings: true,
		toolCalls,
		builtinFunctions: true,
		editMode: false,
	});

	return toolCalls ? stripMutationGuidance(prompt) : prompt;
}
