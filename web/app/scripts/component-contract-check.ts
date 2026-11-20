/** Checks the shared primitive and style contracts for first-party UI. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { RIGHT_PANEL_DEFINITIONS, RIGHT_PANEL_REGISTRY } from "@/components/layout/right-panel-registry";
import { sessionAgentPlanPresentation } from "@/components/tools/session-agent-plan";
import { SETTINGS_SECTIONS, SETTINGS_SECTION_REGISTRY, isSettingsSectionId } from "@/lib/settings/settings-sections";
import {
	findStaticInlineStyleViolations,
	nativeControlPattern,
	relativeUiImportPattern,
} from "./component-contract-patterns";

const APP_ROOT = resolve(import.meta.dirname, "..");
const APP_SRC = join(APP_ROOT, "src");
const COMPONENT_SOURCES_PATH = join(APP_ROOT, "component-sources.json");

// Framework-defined entry points: routes are loaded by the router, not imported.
const FRAMEWORK_ENTRY_PATHS = ["src/routes/", "src/router.tsx"];

function collectFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (entry.startsWith(".")) continue;
		if (entry === "node_modules" || entry === "dist") continue;
		if (statSync(full).isDirectory()) collectFiles(full, out);
		else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
	}
	return out;
}

const isFrameworkEntry = (file: string) => {
	const relativePath = relative(APP_ROOT, file).replaceAll("\\", "/");
	return (
		FRAMEWORK_ENTRY_PATHS.some((prefix) => relativePath.startsWith(prefix)) ||
		relativePath.endsWith("routeTree.gen.ts")
	);
};
const componentSources = collectFiles(APP_SRC).filter((file) => !isFrameworkEntry(file));
const { nativeControlExceptions } = JSON.parse(readFileSync(COMPONENT_SOURCES_PATH, "utf8")) as {
	nativeControlExceptions: string[];
};
const exceptions = new Set(nativeControlExceptions);
const directBaseUiImports: string[] = [];
const unsupportedIconImports: string[] = [];
const nativeControlViolations: string[] = [];
const relativeUiImports: string[] = [];
const staticInlineStyleViolations: Array<{ file: string; line: number; properties: string[] }> = [];
for (const file of componentSources) {
	const source = readFileSync(file, "utf8");
	const relativePath = relative(APP_ROOT, file).replaceAll("\\", "/");
	const isProductComponent =
		relativePath.startsWith("src/components/") && !relativePath.startsWith("src/components/ui/");
	const isTestFile = /\.test\.tsx?$/.test(relativePath);
	if (/from ["']@base-ui\/react/.test(source) && !relativePath.startsWith("src/components/ui/")) {
		directBaseUiImports.push(file);
	}
	if (/from ["'](?:@tabler\/icons-react|@heroicons\/|react-icons)/.test(source)) {
		unsupportedIconImports.push(file);
	}
	if (isProductComponent && relativeUiImportPattern.test(source)) {
		relativeUiImports.push(file);
	}
	if (isProductComponent && !isTestFile && nativeControlPattern.test(source) && !exceptions.has(relativePath)) {
		nativeControlViolations.push(file);
	}
	const syntaxKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, syntaxKind);
	if (isProductComponent && !isTestFile) {
		for (const violation of findStaticInlineStyleViolations(sourceFile)) {
			staticInlineStyleViolations.push({ file, ...violation });
		}
	}
}

let failures = 0;

for (const [label, files] of [
	["direct Base UI import(s) outside components/ui", directBaseUiImports],
	["unsupported icon-library import(s)", unsupportedIconImports],
	["new native product control(s) without a documented exception", nativeControlViolations],
	["relative product → ui import(s) (use @/components/ui/...)", relativeUiImports],
] as const) {
	if (files.length === 0) continue;
	failures += files.length;
	console.error(`\n[check:components] ${files.length} ${label}:`);
	for (const file of files) console.error(`    - ${relative(APP_ROOT, file).replaceAll("\\", "/")}`);
}

if (staticInlineStyleViolations.length > 0) {
	failures += staticInlineStyleViolations.length;
	console.error(
		`\n[check:components] ${staticInlineStyleViolations.length} static inline style literal(s) outside components/ui:`,
	);
	for (const violation of staticInlineStyleViolations) {
		console.error(
			`    - ${relative(APP_ROOT, violation.file).replaceAll("\\", "/")}:${violation.line} (${violation.properties.join(", ")})`,
		);
	}
}

if (failures > 0) {
	console.error(`\n[check:components] ${failures} violation(s) found.`);
	process.exitCode = 1;
} else {
	console.log("Component contract checks passed.");

	const fixtureRoot = resolve(import.meta.dirname, "fixtures", "component-contract");
	const readFixture = (name: string) => readFileSync(join(fixtureRoot, name), "utf8");
	const parseTsx = (source: string) =>
		ts.createSourceFile("fixture.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

	assert.match(readFixture("direct-base-ui.tsx.fixture"), /from ["']@base-ui\/react/);
	assert.match(readFixture("native-product-button.tsx.fixture"), nativeControlPattern);
	assert.match("<dialog open />", nativeControlPattern);
	assert.match('<m.button type="button" />', nativeControlPattern);
	assert.doesNotMatch('<Button type="button" />', nativeControlPattern);
	assert.match(
		readFixture("unsupported-icon-library.tsx.fixture"),
		/from ["'](?:@tabler\/icons-react|@heroicons\/|react-icons)/,
	);
	for (const invalidImport of readFixture("relative-ui-imports.tsx.fixture").trim().split("\n")) {
		assert.match(invalidImport, relativeUiImportPattern);
	}
	assert.doesNotMatch('import { utility } from "../utility"', relativeUiImportPattern);
	assert.doesNotMatch('const uiKit = import("../../ui-kit")', relativeUiImportPattern);
	const staticStyleViolations = findStaticInlineStyleViolations(
		parseTsx(readFixture("static-inline-style.tsx.fixture")),
	);
	assert.equal(staticStyleViolations.length, 3);
	assert.deepEqual(
		staticStyleViolations.map((entry) => entry.properties),
		[["backgroundColor", "position"], ["gridArea", "fontSize", "marginTop"], ["width"]],
	);
	const dynamicStyleSample = `
export function DynamicStyles() {
  return (
    <>
      <div style={{ "--tree-depth": depth }} />
      <aside style={{ ...style, "--sidebar-width": sidebarWidth }} />
      <div style={{ height: totalHeight }} />
      <div style={{ top: offsets[itemIndex] }} />
      <div style={{ maxHeight }} />
      <div style={{ aspectRatio }} />
      <div style={{ animationDelay: \`\${index * 70}ms\` }} />
      <div style={chatLayoutStyle} />
      <div style={splitStyle} />
      <div style={rowStyle} />
      <span style={token.htmlStyle} />
    </>
  );
}
`;
	assert.deepEqual(findStaticInlineStyleViolations(parseTsx(dynamicStyleSample)), []);
	const aliasedStyles = parseTsx(`
const chromeStyle = { position: "fixed", top: 0 } as const;
function Shell() {
  const gridStyle = { gridTemplateAreas: '"preview handle tree"', width: measuredWidth };
  return <><div style={chromeStyle} /><div style={gridStyle} /></>;
}
`);
	assert.deepEqual(
		findStaticInlineStyleViolations(aliasedStyles).map((entry) => entry.properties),
		[["position", "top"], ["gridTemplateAreas"]],
	);
	assert.deepEqual(
		findStaticInlineStyleViolations(
			parseTsx(`
const style = { position: "fixed" };
function Dynamic({ style }) { return <div style={style} />; }
`),
		),
		[],
	);
	console.log("Negative component contract fixtures passed.");

	assert.deepEqual(
		RIGHT_PANEL_DEFINITIONS.map(({ id }) => id),
		["resources", "workspace", "artifacts", "repl", "subagents", "session-insights", "session-tree", "dashboards"],
	);
	assert.equal(new Set(RIGHT_PANEL_DEFINITIONS.map(({ order }) => order)).size, RIGHT_PANEL_DEFINITIONS.length);
	for (const definition of RIGHT_PANEL_DEFINITIONS) {
		assert.equal(RIGHT_PANEL_REGISTRY[definition.id], definition);
		assert.ok(definition.title && definition.ariaLabel && definition.commandLabel);
		assert.ok(definition.commandKeywords.length > 0);
		assert.ok(definition.dataTestid && definition.mobileDataTestid);
	}
	assert.equal(RIGHT_PANEL_REGISTRY.resources.badgeSource, "resources");
	assert.equal(RIGHT_PANEL_REGISTRY.artifacts.badgeSource, "artifacts");
	assert.equal(RIGHT_PANEL_REGISTRY.workspace.refreshSource, "workspace");
	assert.deepEqual(
		SETTINGS_SECTIONS.map(({ id }) => id),
		[
			"appearance",
			"chat",
			"mcp",
			"sandbox",
			"providers",
			"llm-models",
			"skills",
			"keybindings",
			"sessions",
			"context",
			"retry-delivery",
			"prompts",
			"extensions-packages",
			"services",
		],
	);
	assert.equal(new Set(SETTINGS_SECTIONS.map(({ order }) => order)).size, SETTINGS_SECTIONS.length);
	for (const section of SETTINGS_SECTIONS) {
		assert.equal(SETTINGS_SECTION_REGISTRY[section.id], section);
		assert.ok(section.title && section.ariaLabel);
		assert.equal(isSettingsSectionId(section.id), true);
	}
	assert.equal(isSettingsSectionId("unknown"), false);
	console.log("Component registry checks passed.");

	const pending = [
		{ id: "1", title: "Inspect the request", status: "pending" as const },
		{ id: "2", title: "Build the change", status: "pending" as const },
	];
	assert.deepEqual(sessionAgentPlanPresentation(pending), {
		steps: ["Inspect the request", "Build the change"],
		activeIndex: 0,
	});
	assert.deepEqual(
		sessionAgentPlanPresentation([
			{ id: "1", title: "Inspect the request", status: "completed" },
			{ id: "2", title: "Build the change", status: "in_progress" },
			{ id: "3", title: "Validate the result", status: "pending" },
		]),
		{
			steps: ["Inspect the request", "Build the change", "Validate the result"],
			activeIndex: 1,
		},
	);
	assert.deepEqual(
		sessionAgentPlanPresentation([
			{ id: "1", title: "Inspect the request", status: "completed" },
			{ id: "2", title: "Build the change", status: "completed" },
		]),
		{
			steps: ["Inspect the request", "Build the change"],
			activeIndex: 2,
		},
	);
	assert.equal(
		sessionAgentPlanPresentation([
			{ id: "1", title: "Inspect the request", status: "pending" },
			{ id: "2", title: "Build the change", status: "completed" },
		]),
		undefined,
	);
	assert.equal(sessionAgentPlanPresentation([{ id: "1", title: "   ", status: "pending" }]), undefined);
	console.log("Fleet Agent Plan adapter checks passed.");
}
