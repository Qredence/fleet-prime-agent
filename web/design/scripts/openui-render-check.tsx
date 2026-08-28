/**
 * openui render harness — parses + renders a canned openui-lang program
 * through the real `openUILibrary` and asserts expected markup is present.
 *
 * Run: npx tsx scripts/openui-render-check.tsx
 * Exits non-zero on parse validation errors, render throws, or missing assertions.
 *
 * Stages:
 *   1. parse    — createParser(openUILibrary.toJSONSchema(), "Root"), fail on meta.errors
 *   2. static   — renderToStaticMarkup(<Renderer .../>); text assertions
 *   3. dom      — client render into happy-dom; SVG assertions
 *
 * Why stage 3 exists: recharts 3.x gates <Surface> on a redux-store chart size that
 * ReportChartSize only dispatches from a useEffect, so renderToStaticMarkup can never
 * emit chart SVG (empty `.recharts-wrapper`). Painting the svg requires one effect
 * flush, which stage 3 performs inside happy-dom via act().
 */
import { Window } from "happy-dom";
import { createParser, Renderer } from "@openuidev/react-lang";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MotionRuntime } from "../src/components/motion/runtime";
import {
	DataTableDef,
	buildSortComparator,
	cycleSortState,
	formatCurrency,
	formatPercent,
} from "../src/components/openui/data";
import { CitationDef, openUILibrary } from "../src/components/openui/openui-library";
import { validateAndNormalizeOpenUIHtmlArtifact } from "@prime-agent/web-protocol/openui-artifact";
import {
	segmentOpenUIContent,
	stripOpenUIWrapper,
} from "../src/components/openui/openui-utils";
import type { OpenUIContentSegment } from "../src/components/openui/openui-utils";
import { sanitizeChartColor } from "../src/components/chart";
import { isSafeExternalUrl } from "../src/lib/safe-external-url";

// --- happy-dom window + node globalThis shims ---
const win = new Window();

// window/document are absent in Node; navigator exists in Node 24 as a
// getter-only global, so plain assignment throws — defineProperty is required.
Object.defineProperty(globalThis, "window", { value: win, configurable: true, writable: true });
Object.defineProperty(globalThis, "document", { value: win.document, configurable: true, writable: true });
Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true });

// DOM constructors/globals the component tree touches during DOM rendering
// (@base-ui via @floating-ui, recharts, react-dom portals).
const GLOBAL_KEYS = [
	"location",
	"history",
	"HTMLElement",
	"SVGElement",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"ShadowRoot",
	"DocumentType",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"PointerEvent",
	"FocusEvent",
	"InputEvent",
	"WheelEvent",
	"TouchEvent",
	"AnimationEvent",
	"TransitionEvent",
	"MutationObserver",
	"ResizeObserver",
	"IntersectionObserver",
	"getComputedStyle",
	"getSelection",
	"matchMedia",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"DOMParser",
	"DOMRect",
	"FileReader",
	"Image",
	"CSSStyleSheet",
	"HTMLInputElement",
	"HTMLButtonElement",
	"HTMLDivElement",
	"HTMLAnchorElement",
	"HTMLDialogElement",
	"HTMLStyleElement",
	"HTMLFormElement",
	"HTMLSelectElement",
	"HTMLTextAreaElement",
	"HTMLSpanElement",
	"HTMLUListElement",
	"HTMLLIElement",
	"HTMLHeadingElement",
	"HTMLParagraphElement",
	"HTMLPreElement",
	"HTMLTableElement",
] as const;

for (const key of GLOBAL_KEYS) {
	const value = (win as unknown as Record<string, unknown>)[key];
	if (value === undefined) continue;
	Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

// Let React act() flush recharts' mount effects in stage 3.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout engine; every element measures 0x0, and recharts'
// ResponsiveContainer would then report a 0-size container and skip painting.
const STUB_RECT = { x: 0, y: 0, top: 0, left: 0, width: 640, height: 320, right: 640, bottom: 320 };
(win.Element.prototype as any).getBoundingClientRect = () => STUB_RECT;

// --- Canned program (covered defs: wave-1 LineChart/DonutChart + base defs) ---
const payload = [
	'$field = "x"',
	"$on = true",
	'$s = "a"',
	"root = Root([inp, sel, sw, mdl, panel, traffic, share, scores, kpis])",
	'inp = Input("field", $field, "hint")',
	'sel = Select("s", $s, [{"value": "a", "label": "A"}], "Pick")',
	'sw = Switch("on", $on, "Toggle")',
	'mdl = Modal("m", $on, "Confirm", "body text")',
	'panel = PanelAction("Open workspace", "workspace", "README.md", true)',
	'traffic = LineChart("Traffic", "Weekly visits", "week", [{"dataKey":"visits","label":"Visits","color":"red;}</style><img src=x onerror=alert(1)>"},{"dataKey":"views","label":"Views","color":"var(--chart-1)"}], [{"week":"W1","visits":10,"views":5},{"week":"W2","visits":24,"views":8},{"week":"W3","visits":18,"views":6}])',
	'share = DonutChart("Share", null, [{"label":"Alpha","value":40},{"label":"Beta","value":60}], "100%")',
	'scores = DataTable("Scores", [{"key":"name","label":"Name"},{"key":"points","label":"Points","type":"number"}], [{"name":"Ada","points":7},{"name":"Bo","points":12}])',
	'kpis = MetricGroup([{"label":"Users","value":"12,403","delta":"+4.2%","deltaTone":"up","sparkline":[3,5,4,8,9]},{"label":"Errors","value":"3","delta":"-66%","deltaTone":"down"}])',
].join("\n");

let failures = 0;

function assertIncludes(html: string, expected: string) {
	if (html.includes(expected)) {
		console.log(`  PASS html includes "${expected}"`);
	} else {
		console.error(`  FAIL html missing "${expected}"`);
		failures += 1;
	}
}

function styleTagContents(html: string): string {
	return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
		.map((match) => match[1] ?? "")
		.join("\n");
}

function assertExcludes(html: string, unexpected: string, label: string) {
	if (html.includes(unexpected)) {
		console.error(`  FAIL ${label} — html contains ${JSON.stringify(unexpected)}`);
		failures += 1;
	} else {
		console.log(`  PASS ${label}`);
	}
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
	if (JSON.stringify(actual) === JSON.stringify(expected)) {
		console.log(`  PASS ${label}`);
	} else {
		console.error(`  FAIL ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
		failures += 1;
	}
}

// --- Unit asserts: segment identity invariants + data.tsx pure helpers ---
console.log("UNIT ASSERTS (OpenUI segment identities + data.tsx helpers):");

const completedPrefix = "Intro\n```openui\nroot = Root([])\n```";
const appendedResponse = [
	completedPrefix,
	"Outro",
	"```openui",
	"root = Root([])",
	"```",
].join("\n");
const legacySegment: OpenUIContentSegment = {
	type: "markdown",
	content: "legacy source-compatible segment",
};
assertEqual(
	legacySegment.id,
	undefined,
	"legacy OpenUI segment literals do not require an id",
);

const completedPrefixSegments = segmentOpenUIContent(completedPrefix);
const appendedSegments = segmentOpenUIContent(appendedResponse);

assertEqual(
	segmentOpenUIContent("Intro\n```openui\nroot = Root([])\n```\nOutro").map(({ id, type }) => ({ id, type })),
	[
		{ id: "markdown-0", type: "markdown" },
		{ id: "openui-0", type: "openui" },
		{ id: "markdown-1", type: "markdown" },
	],
	"fenced OpenUI segments receive stable type-ordinal IDs",
);
assertEqual(
	appendedSegments.slice(0, completedPrefixSegments.length).map(({ id, type }) => ({ id, type })),
	completedPrefixSegments.map(({ id, type }) => ({ id, type })),
	"completed OpenUI segments retain identities when later content appends",
);
const twoCompletedFences = "```openui\nroot = Root([])\n```\n```openui\nroot = Root([])\n```";
assertEqual(
	stripOpenUIWrapper(twoCompletedFences),
	twoCompletedFences,
	"multiple fenced blocks are not treated as one OpenUI wrapper",
);
assertEqual(
	segmentOpenUIContent(twoCompletedFences).map(({ id, type }) => ({ id, type })),
	[
		{ id: "openui-0", type: "openui" },
		{ id: "openui-1", type: "openui" },
	],
	"completed OpenUI blocks retain sequential identities",
);
assertEqual(
	segmentOpenUIContent("root = Root([])").map(({ id, type }) => ({ id, type })),
	[{ id: "openui-0", type: "openui" }],
	"raw OpenUI programs receive the first OpenUI identity",
);

assertEqual(formatCurrency(12000), "$12,000", "formatCurrency(12000)");
assertEqual(formatPercent(0.124), "12.4%", "formatPercent(0.124)");
assertEqual(formatPercent(12.4), "12.4%", "formatPercent(12.4)");

assertEqual(sanitizeChartColor("#3b82f6"), "#3b82f6", "sanitizeChartColor hex");
assertEqual(sanitizeChartColor("var(--chart-1)"), "var(--chart-1)", "sanitizeChartColor CSS variable");
assertEqual(
	sanitizeChartColor("red;}</style><img src=x onerror=alert(1)>"),
	undefined,
	"sanitizeChartColor rejects style breakout",
);

assertEqual(cycleSortState("a", null), { key: "a", dir: "asc" }, 'cycleSortState("a", null)');
assertEqual(
	cycleSortState("a", { key: "a", dir: "asc" }),
	{ key: "a", dir: "desc" },
	'cycleSortState("a", {key:"a",dir:"asc"})'
);
assertEqual(cycleSortState("a", { key: "a", dir: "desc" }), null, 'cycleSortState("a", {key:"a",dir:"desc"})');
assertEqual(
	cycleSortState("b", { key: "a", dir: "desc" }),
	{ key: "b", dir: "asc" },
	'cycleSortState("b", ...) starts the new key on asc'
);

const numericComparator = buildSortComparator({ key: "points", type: "number" });
const sortedPoints = [{ points: 12 }, { points: 7 }, { points: "n/a" }].sort(numericComparator);
assertEqual(
	sortedPoints.map((row) => row.points),
	[7, 12, "n/a"],
	"buildSortComparator(number): ascending, non-numerics last"
);

// Task 2 finding 2: desc must keep non-numeric rows LAST (was: arg-swap put them first)
const descNumericComparator = buildSortComparator({ key: "points", type: "number" }, "desc");
const descSortedPoints = [{ points: 7 }, { points: "n/a" }, { points: 12 }].sort(descNumericComparator);
assertEqual(
	descSortedPoints.map((row) => row.points),
	[12, 7, "n/a"],
	"buildSortComparator(number, desc): descending, non-numerics last"
);

// Task 2 finding 1: align zod enum admits exactly left/right (no "center" leak into prompt schema)
const alignEnum = DataTableDef.props.shape.columns.element.shape.align.unwrap();
assertEqual(
	alignEnum.options,
	["left", "right"],
	'DataTable align zod enum is exactly ["left","right"]'
);
assertEqual(isSafeExternalUrl("https://example.com/source"), true, "Citation accepts HTTPS URLs");
assertEqual(isSafeExternalUrl("http://example.com/source"), true, "Citation accepts HTTP URLs");
for (const unsafeUrl of ["javascript:alert(1)", "data:text/html,unsafe", "file:///etc/passwd"]) {
	assertEqual(isSafeExternalUrl(unsafeUrl), false, `Citation rejects ${unsafeUrl.split(":", 1)[0]} URLs`);
}
assertEqual(
	CitationDef.props.safeParse({ title: "Source", url: "javascript:alert(1)" }).success,
	false,
	"Citation schema rejects unsafe URL schemes",
);

// --- Stage 1: parse + validate against the library schema ---
const parser = createParser(openUILibrary.toJSONSchema(), "Root");
const artifactProgram = [
	"root = Root([artifact])",
	`artifact = HtmlArtifact(${JSON.stringify("Fleet Agent architecture")}, ${JSON.stringify("<!doctype html><html><body><h1>Fleet Agent</h1></body></html>")})`,
].join("\n");
const artifactParse = parser.parse(artifactProgram);
assertEqual(artifactParse.meta.errors.length, 0, "HtmlArtifact program parses without contract errors");

const malformedArtifactParse = parser.parse("root = Root([missing])");
assertEqual(
	malformedArtifactParse.meta.errors.length > 0 || malformedArtifactParse.meta.unresolved.length > 0,
	true,
	"malformed OpenUI reports parser errors",
);

const unsafeArtifactValidation = validateAndNormalizeOpenUIHtmlArtifact({
	title: "Unsafe",
	document: '<script src="https://example.com/app.js"></script>',
});
assertEqual(unsafeArtifactValidation.ok, false, "unsafe HtmlArtifact documents fail validation");
const result = parser.parse(payload);

if (result.meta.errors.length > 0) {
	console.error(`PARSE FAILED (${result.meta.errors.length} error(s)):`);
	for (const error of result.meta.errors) {
		console.error(`  - [${error.code}] ${error.message}`);
	}
	process.exit(1);
}
console.log("PARSE OK");

if (!result.root) {
	console.error("PARSE FAILED: parser produced no root element");
	process.exit(1);
}

// --- Stage 2: static render ---
let staticHtml = "";
try {
	staticHtml = renderToStaticMarkup(
		<MotionRuntime>
			<Renderer response={payload} library={openUILibrary} />
		</MotionRuntime>,
	);
} catch (error) {
	console.error("RENDER THREW (static):", error);
	process.exit(1);
}

if (staticHtml.length === 0) {
	console.error("RENDER FAILED: renderToStaticMarkup returned empty output");
	process.exit(1);
}
console.log("RENDER OK (static)");

const artifactStaticHtml = renderToStaticMarkup(
	<MotionRuntime>
		<Renderer response={artifactProgram} library={openUILibrary} />
	</MotionRuntime>,
);
assertIncludes(artifactStaticHtml, "Fleet Agent architecture");
assertIncludes(artifactStaticHtml, "sandbox=\"allow-scripts\"");
assertIncludes(artifactStaticHtml, "srcDoc");
assertExcludes(artifactStaticHtml, "https://example.com/app.js", "valid HtmlArtifact preview has no external script");

const streamingArtifactHtml = renderToStaticMarkup(
	<MotionRuntime>
		<Renderer response={artifactProgram} library={openUILibrary} isStreaming />
	</MotionRuntime>,
);
assertIncludes(streamingArtifactHtml, "Generating artifact");

const unsafeArtifactHtml = renderToStaticMarkup(
	<MotionRuntime>
		<Renderer
			response={`root = Root([artifact])\nartifact = HtmlArtifact(${JSON.stringify("Unsafe")}, ${JSON.stringify('<script src="https://example.com/app.js"></script>')})`}
			library={openUILibrary}
		/>
	</MotionRuntime>,
);
assertIncludes(unsafeArtifactHtml, "OpenUI artifact was not rendered");
assertExcludes(unsafeArtifactHtml, "sandbox=\"allow-scripts\"", "unsafe HtmlArtifact never renders an iframe");

const unsafeCitationHtml = renderToStaticMarkup(
	<MotionRuntime>
		<Renderer response={'root = Citation("Source", "javascript:alert(1)")'} library={openUILibrary} />
	</MotionRuntime>,
);
assertExcludes(unsafeCitationHtml, "<a ", "unsafe Citation URLs never render an anchor");

for (const expected of ["Open workspace", "Traffic", "Weekly visits", "Share", "100%", "Scores", "Ada", "Bo", "Points", "Users", "12,403", "+4.2%", "Errors", "var(--chart-1)"]) {
	assertIncludes(staticHtml, expected);
}
assertExcludes(
	styleTagContents(staticHtml),
	"</style><img",
	"malicious chart color does not break out of <style>",
);

// --- Stage 3: DOM render in happy-dom (flushes effects; recharts SVG paints) ---
let domHtml = "";
try {
	const container = win.document.createElement("div");
	win.document.body.appendChild(container);
	const root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<MotionRuntime>
				<Renderer response={payload} library={openUILibrary} />
			</MotionRuntime>,
		);
	});
	domHtml = win.document.body.innerHTML;
	await act(async () => {
		root.unmount();
	});
} catch (error) {
	console.error("RENDER THREW (dom):", error);
	process.exit(1);
}
console.log("RENDER OK (dom)");

for (const expected of [
	"Traffic",
	"Open workspace",
	"Weekly visits",
	"Share",
	"100%",
	"recharts-line",
	"recharts-pie",
	"recharts-area",
	"Scores",
	"Ada",
	"Bo",
	"Points",
	"Users",
	"12,403",
	"+4.2%",
	"Errors",
	"var(--chart-1)",
]) {
	assertIncludes(domHtml, expected);
}
assertExcludes(
	styleTagContents(domHtml),
	"</style><img",
	"malicious chart color does not break out of <style> (dom)",
);

if (failures > 0) {
	console.error(`${failures} assertion(s) failed`);
	process.exit(1);
}

console.log("ALL ASSERTIONS PASSED");
