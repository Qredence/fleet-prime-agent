/** Checks the shared primitive and style contracts for first-party UI. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
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

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

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

if (failures === 0) {
	console.log("Component contract checks passed.");
} else {
	console.error(`\n[check:components] ${failures} violation(s) found.`);
	process.exitCode = 1;
}
