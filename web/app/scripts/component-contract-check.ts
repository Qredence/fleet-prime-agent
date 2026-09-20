/**
 * Component contract gate for the Fleet Prime web application.
 *
 * Enforces the rules that keep the app's component sources from drifting:
 *
 *  1. One name, one home — a non-conventional file basename
 *     (`index.ts(x)`, `types.ts`, `*.test.*`, `*.bench.*` are exempt) may
 *     exist at most once under `src/`.
 *  2. No dead files — every component source must be imported by at least one
 *     other workspace file (`src/`, `scripts/`), unless it is listed in the
 *     `doctor.config.jsonc` waiver blocks (reserved/future UI and public
 *     wildcard-export surfaces are documented there).
 *  3. Primitive boundaries — Base UI imports stay in `components/ui`, product
 *     areas do not reach into `ui/` relatively, native controls in product
 *     areas are documented, and public prop contracts stay narrow.
 *
 * Framework-defined route modules (`src/routes`, `src/router.tsx`,
 * `routeTree.gen.ts`) are entry points rather than component sources: they are
 * excluded from the basename, dead-file, and primitive-boundary rules.
 *
 * Fails with exit code 1 and a violation report otherwise.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { extname, basename, dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { relativeUiImportPattern } from "./component-contract-patterns";

const APP_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(APP_ROOT, "..", "..");
const APP_SRC = join(APP_ROOT, "src");
const APP_SCRIPTS = join(APP_ROOT, "scripts");
const COMPONENT_SOURCES_PATH = join(APP_ROOT, "component-sources.json");
const DOCTOR_CONFIG_PATH = join(APP_ROOT, "doctor.config.jsonc");

const ENTRY_EXEMPTIONS = new Set(["routeTree.gen.ts"]);
const NAME_CONVENTIONS = new Set(["index", "types", "utils", "cn", "index.test"]);
// Framework-defined entry points: routes are loaded by the router, not imported.
const FRAMEWORK_ENTRY_PATHS = ["src/routes/", "src/router.tsx"];

// ---------------------------------------------------------------------------
// doctor.config.jsonc waiver files (JSONC -> JSON with a comment-aware stripper)
// ---------------------------------------------------------------------------

function stripJsonc(source: string): string {
	let out = "";
	let inString = false;
	let escaped = false;
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index] ?? "";
		const next = source[index + 1] ?? "";
		if (inString) {
			out += char;
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
			out += char;
			continue;
		}
		if (char === "/" && next === "/") {
			while (index < source.length && source[index] !== "\n") index += 1;
			out += "\n";
			continue;
		}
		if (char === "/" && next === "*") {
			index += 2;
			while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
			index += 1;
			continue;
		}
		// trailing commas are legal in JSONC: drop one followed only by a close
		if (char === ",") {
			let lookahead = index + 1;
			while (lookahead < source.length && /\s/.test(source[lookahead] ?? "")) lookahead += 1;
			if (source[lookahead] === "}" || source[lookahead] === "]") continue;
		}
		out += char;
	}
	return out;
}

function loadWaivedPaths(): Set<string> {
	const waived = new Set<string>();
	if (!existsSync(DOCTOR_CONFIG_PATH)) return waived;
	try {
		const config = JSON.parse(stripJsonc(readFileSync(DOCTOR_CONFIG_PATH, "utf8"))) as unknown;
		const overrides = (config as { ignore?: { overrides?: Array<{ files?: unknown }> } })?.ignore?.overrides ?? [];
		if (!Array.isArray(overrides)) return waived;
		for (const block of overrides) {
			const files = Array.isArray(block?.files) ? (block.files as unknown[]) : [];
			for (const file of files) {
				if (typeof file === "string") waived.add(file.replaceAll("\\", "/"));
			}
		}
	} catch (error) {
		console.error(`component-contract-check: unable to parse ${DOCTOR_CONFIG_PATH}: ${String(error)}`);
		process.exitCode = 1;
	}
	return waived;
}

// ---------------------------------------------------------------------------
// Workspace import graph
// ---------------------------------------------------------------------------

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

const FILE_CANDIDATE_EXTENSIONS = [".ts", ".tsx", ".js"];

function resolveSpecifier(importer: string, specifier: string, files: Set<string>): string | undefined {
	let base: string;
	if (specifier.startsWith("@/")) {
		base = resolve(APP_SRC, specifier.slice(2));
	} else if (specifier.startsWith(".")) {
		base = resolve(dirname(importer), specifier);
	} else {
		return undefined; // bare package import
	}
	const hasExtension = /\.(ts|tsx|js)$/.test(base);
	const candidates = hasExtension
		? [base]
		: [
				base,
				...FILE_CANDIDATE_EXTENSIONS.map((ext) => `${base}${ext}`),
				...FILE_CANDIDATE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
			];
	for (const candidate of candidates) {
		if (files.has(candidate) && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return undefined;
}

const IMPORT_PATTERN = /(?:from\s+|import\s+|require\(\s*|import\(\s*)(['"])([^'"]+)\1/g;

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const isFrameworkEntry = (file: string) => {
	const relativePath = relative(APP_ROOT, file).replaceAll("\\", "/");
	return FRAMEWORK_ENTRY_PATHS.some((prefix) => relativePath.startsWith(prefix)) || relativePath.endsWith("routeTree.gen.ts");
};
const componentSources = collectFiles(APP_SRC).filter((file) => !isFrameworkEntry(file));
const importerFiles = [...collectFiles(APP_SRC), ...collectFiles(APP_SCRIPTS)];
const fileSet = new Set(componentSources);
const sourceManifest = JSON.parse(readFileSync(COMPONENT_SOURCES_PATH, "utf8")) as {
	widePropExceptions: Array<{ path: string; type: string; reason: string }>;
	nativeControlExceptions: string[];
};

// Rule 1: basename uniqueness (conventional shared names exempt)
const byBasename = new Map<string, string[]>();
for (const file of componentSources) {
	const name = basename(file, extname(file));
	if (NAME_CONVENTIONS.has(name) || ENTRY_EXEMPTIONS.has(basename(file))) continue;
	if (name.endsWith(".test") || name.endsWith(".bench")) continue;
	const list = byBasename.get(name) ?? [];
	list.push(file);
	byBasename.set(name, list);
}
const duplicates: Array<[string, string[]]> = [];
for (const [name, list] of byBasename) {
	if (list.length > 1) duplicates.push([name, list]);
}
duplicates.sort((a, b) => a[0].localeCompare(b[0]));

// Rule 2: dead files (zero workspace importers, waivers exempt)
const waived = loadWaivedPaths();
const referenced = new Set<string>();
for (const importer of importerFiles) {
	const source = readFileSync(importer, "utf8");
	let match: RegExpExecArray | null;
	IMPORT_PATTERN.lastIndex = 0;
	while ((match = IMPORT_PATTERN.exec(source))) {
		const target = resolveSpecifier(importer, match[2] as string, fileSet);
		if (target) referenced.add(target);
	}
}
const deadFiles = componentSources.filter((file) => {
	if (referenced.has(file)) return false;
	if (ENTRY_EXEMPTIONS.has(basename(file))) return false;
	// Tests and benches are executed by their runner rather than imported.
	if (/\.(test|bench)\.(ts|tsx)$/.test(file)) return false;
	const appRelative = relative(APP_ROOT, file).replaceAll("\\", "/"); // doctor paths are relative to the app root
	const repoRelative = relative(REPO_ROOT, file).replaceAll("\\", "/");
	return !waived.has(appRelative) && !waived.has(repoRelative);
});
deadFiles.sort();

// Rule 3: primitive boundaries for first-party product UI.
const directBaseUiImports: string[] = [];
const unsupportedIconImports: string[] = [];
const nativeControlViolations: string[] = [];
const relativeUiImports: string[] = [];
const widePropViolations: Array<{ file: string; type: string; count: number }> = [];
const nativeControlExceptions = new Set(sourceManifest.nativeControlExceptions);
const widePropExceptions = new Set(
	sourceManifest.widePropExceptions.map((entry) => `${entry.path}:${entry.type}`),
);
const nativeControlPattern = /<(?:button|input|select|textarea)\b/;
const nativeControlRoots = [
	"src/components/layout/",
	"src/components/settings/",
	"src/components/sessions/",
	"src/components/workspace/",
	"src/components/artifacts/",
	"src/components/chat/subagents/",
	"src/components/chat/agent-chat",
	"src/components/chat/composer/input-bar",
	"src/components/chat/fork-picker-dialog",
];
for (const file of componentSources) {
	const source = readFileSync(file, "utf8");
	const relativePath = relative(APP_ROOT, file).replaceAll("\\", "/");
	if (/from ["']@base-ui\/react/.test(source) && !relativePath.startsWith("src/components/ui/")) {
		directBaseUiImports.push(file);
	}
	if (/from ["'](?:@tabler\/icons-react|@heroicons\/|react-icons)/.test(source)) {
		unsupportedIconImports.push(file);
	}
	if (
		relativePath.startsWith("src/components/") &&
		!relativePath.startsWith("src/components/ui/") &&
		relativeUiImportPattern.test(source)
	) {
		relativeUiImports.push(file);
	}
	if (
		nativeControlRoots.some((root) => relativePath.startsWith(root)) &&
		!/\.test\.tsx?$/.test(relativePath) &&
		nativeControlPattern.test(source) &&
		!nativeControlExceptions.has(relativePath)
	) {
		nativeControlViolations.push(file);
	}
	if (!relativePath.startsWith("src/components/motion/")) {
		const syntaxKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
		const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, syntaxKind);
		for (const statement of sourceFile.statements) {
			const isExported = ts.canHaveModifiers(statement)
				? ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
				: false;
			if (!isExported) continue;
			let typeName: string | undefined;
			let count = 0;
			if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) {
				typeName = statement.name.text;
				count = statement.type.members.length;
			} else if (ts.isInterfaceDeclaration(statement)) {
				typeName = statement.name.text;
				count = statement.members.length;
			}
			if (
				typeName?.endsWith("Props") &&
				count > 12 &&
				!widePropExceptions.has(`${relativePath}:${typeName}`)
			) {
				widePropViolations.push({ file, type: typeName, count });
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

let failures = 0;

if (duplicates.length > 0) {
	failures += duplicates.length;
	console.error(`\n[check:components] ${duplicates.length} duplicate basename(s) across src/:`);
	for (const [name, files] of duplicates) {
		console.error(`\n  ${name}.${extname(files[0]!).slice(1)}`);
		for (const file of files) {
			console.error(`    - ${relative(APP_ROOT, file).replaceAll("\\", "/")}`);
		}
	}
}

if (deadFiles.length > 0) {
	failures += deadFiles.length;
	console.error(`\n[check:components] ${deadFiles.length} file(s) imported by nothing (and not waived):`);
	for (const file of deadFiles) {
		console.error(`    - ${relative(APP_ROOT, file).replaceAll("\\", "/")}`);
	}
	console.error("  Add a usage, or register an intentional reservation in web/app/doctor.config.jsonc.");
}

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

if (widePropViolations.length > 0) {
	failures += widePropViolations.length;
	console.error(`\n[check:components] ${widePropViolations.length} public prop contract(s) exceed 12 top-level fields:`);
	for (const violation of widePropViolations) {
		console.error(`    - ${relative(APP_ROOT, violation.file).replaceAll("\\", "/")}:${violation.type} (${violation.count})`);
	}
}

if (failures === 0) {
	console.log(
		`Component contract checks passed (${byBasename.size} basenames unique, ${componentSources.length} files referenced).`,
	);
} else {
	console.error(`\n[check:components] ${failures} violation(s) found.`);
	process.exitCode = 1;
}
