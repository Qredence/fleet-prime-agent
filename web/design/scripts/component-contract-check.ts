/**
 * Component contract gate for `@prime-agent/web-design`.
 *
 * Enforces the two rules that kept `components/` from drifting:
 *
 *  1. One name, one home — a non-conventional file basename
 *     (`index.ts(x)`, `types.ts`, `*.test.*` are exempt) may exist at most
 *     once under `design/src`.
 *  2. No dead files — every file under `design/src` must be imported by at
 *     least one other workspace file (`app/`, `design/src`, or `design/scripts`),
 *     unless it is listed in the repo-root `doctor.config.jsonc` waiver blocks
 *     (reserved/future UI and public wildcard-export surfaces are documented there).
 *
 * Fails with exit code 1 and a violation report otherwise.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { extname, basename, dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const DESIGN_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(DESIGN_ROOT, "..", "..");
const DESIGN_SRC = join(DESIGN_ROOT, "src");
const DESIGN_SCRIPTS = join(DESIGN_ROOT, "scripts");
const APP_SRC = resolve(DESIGN_ROOT, "..", "app", "src");
const REGISTRY_ROOT = join(DESIGN_SRC, "components", "registry");
const COMPONENT_SOURCES_PATH = join(DESIGN_ROOT, "component-sources.json");

const ENTRY_EXEMPTIONS = new Set(["routeTree.gen.ts"]);
const NAME_CONVENTIONS = new Set(["index", "types", "utils", "cn", "index.test"]);

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
	const configPath = join(REPO_ROOT, "web", "doctor.config.jsonc");
	if (!existsSync(configPath)) return waived;
	try {
		const config = JSON.parse(stripJsonc(readFileSync(configPath, "utf8"))) as unknown;
		const overrides = (config as { ignore?: { overrides?: Array<{ files?: unknown }> } })?.ignore?.overrides ?? [];
		if (!Array.isArray(overrides)) return waived;
		for (const block of overrides) {
			const files = Array.isArray(block?.files) ? (block.files as unknown[]) : [];
			for (const file of files) {
				if (typeof file === "string") waived.add(file.replaceAll("\\", "/"));
			}
		}
	} catch (error) {
		console.error(`component-contract-check: unable to parse ${configPath}: ${String(error)}`);
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
	if (specifier.startsWith("@prime-agent/web-design/")) {
		base = resolve(DESIGN_SRC, specifier.slice("@prime-agent/web-design/".length));
	} else if (specifier.startsWith("@/")) {
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

const designFiles = collectFiles(DESIGN_SRC);
const importerFiles = [
	...collectFiles(DESIGN_SRC),
	...collectFiles(DESIGN_SCRIPTS),
	...(existsSync(APP_SRC) ? collectFiles(APP_SRC) : []),
];
const fileSet = new Set(designFiles);
const sourceManifest = JSON.parse(readFileSync(COMPONENT_SOURCES_PATH, "utf8")) as {
	sources: Array<{ destination: string; address: string; reviewedVersion: string; checksum: string; status: string }>;
	widePropExceptions: Array<{ path: string; type: string; reason: string }>;
	nativeControlExceptions: string[];
};

// Rule 1: basename uniqueness (conventional shared names exempt)
const byBasename = new Map<string, string[]>();
for (const file of designFiles) {
	const name = basename(file, extname(file));
	if (NAME_CONVENTIONS.has(name) || ENTRY_EXEMPTIONS.has(basename(file))) continue;
	if (name.endsWith(".test")) continue;
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
const deadFiles = designFiles.filter((file) => {
	if (referenced.has(file)) return false;
	if (ENTRY_EXEMPTIONS.has(basename(file))) return false;
	if (/\.test\.(ts|tsx)$/.test(file)) return false;
	const designPath = relative(REPO_ROOT, join("web", relative(REPO_ROOT, file))).replaceAll("\\", "/");
	const projectPath = relative(REPO_ROOT, file).replaceAll("\\", "/"); // doctor paths are relative to "web/" project roots
	const relativeToWeb = relative(resolve(REPO_ROOT, "web"), file).replaceAll("\\", "/");
	const relativeToDesign = relative(DESIGN_ROOT, file).replaceAll("\\", "/");
	return (
		!waived.has(designPath) &&
		!waived.has(projectPath) &&
		!waived.has(relativeToWeb) &&
		!waived.has(relativeToDesign)
	);
});
deadFiles.sort();

// Rule 3: registry provenance and primitive boundaries.
const registryFiles = collectFiles(REGISTRY_ROOT);
const sourceRoots = sourceManifest.sources.map((entry) => ({
	...entry,
	root: resolve(DESIGN_ROOT, entry.destination),
}));
const undeclaredRegistryFiles = registryFiles.filter(
	(file) => !sourceRoots.some(({ root }) => file === root || file.startsWith(`${root}/`)),
);
const invalidSourceEntries = sourceRoots.filter(
	(entry) =>
		!entry.address ||
		!entry.reviewedVersion ||
		!entry.checksum ||
		!["tracked", "patched", "forked"].includes(entry.status) ||
		!existsSync(entry.root),
);

const directBaseUiImports: string[] = [];
const unsupportedIconImports: string[] = [];
const nativeControlViolations: string[] = [];
const widePropViolations: Array<{ file: string; type: string; count: number }> = [];
const nativeControlExceptions = new Set(sourceManifest.nativeControlExceptions);
const widePropExceptions = new Set(
	sourceManifest.widePropExceptions.map((entry) => `${entry.path}:${entry.type}`),
);
const nativeControlPattern = /<(?:button|input|select|textarea)\b/;
for (const file of designFiles) {
	const source = readFileSync(file, "utf8");
	const relativePath = relative(DESIGN_ROOT, file).replaceAll("\\", "/");
	if (/from ["']@base-ui\/react/.test(source) && !relativePath.startsWith("src/components/ui/")) {
		directBaseUiImports.push(file);
	}
	if (/from ["'](?:@tabler\/icons-react|@heroicons\/|react-icons)/.test(source)) {
		unsupportedIconImports.push(file);
	}
	if (
		relativePath.startsWith("src/components/product/") &&
		nativeControlPattern.test(source) &&
		!nativeControlExceptions.has(relativePath)
	) {
		nativeControlViolations.push(file);
	}
	if (!relativePath.startsWith("src/components/registry/")) {
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
	console.error(`\n[check:components] ${duplicates.length} duplicate basename(s) across design/src:`);
	for (const [name, files] of duplicates) {
		console.error(`\n  ${name}.${extname(files[0]!).slice(1)}`);
		for (const file of files) {
			console.error(`    - ${relative(DESIGN_ROOT, file).replaceAll("\\", "/")}`);
		}
	}
}

if (deadFiles.length > 0) {
	failures += deadFiles.length;
	console.error(`\n[check:components] ${deadFiles.length} file(s) imported by nothing (and not waived):`);
	for (const file of deadFiles) {
		console.error(`    - ${relative(DESIGN_ROOT, file).replaceAll("\\", "/")}`);
	}
	console.error("  Add a usage, or register an intentional reservation in doctor.config.jsonc.");
}

for (const [label, files] of [
	["registry file(s) without component-sources.json provenance", undeclaredRegistryFiles],
	["direct Base UI import(s) outside components/ui", directBaseUiImports],
	["unsupported icon-library import(s)", unsupportedIconImports],
	["new native product control(s) without a documented exception", nativeControlViolations],
] as const) {
	if (files.length === 0) continue;
	failures += files.length;
	console.error(`\n[check:components] ${files.length} ${label}:`);
	for (const file of files) console.error(`    - ${relative(DESIGN_ROOT, file).replaceAll("\\", "/")}`);
}

if (invalidSourceEntries.length > 0) {
	failures += invalidSourceEntries.length;
	console.error(`\n[check:components] ${invalidSourceEntries.length} invalid provenance declaration(s):`);
	for (const entry of invalidSourceEntries) console.error(`    - ${entry.destination}`);
}

if (widePropViolations.length > 0) {
	failures += widePropViolations.length;
	console.error(`\n[check:components] ${widePropViolations.length} public prop contract(s) exceed 12 top-level fields:`);
	for (const violation of widePropViolations) {
		console.error(`    - ${relative(DESIGN_ROOT, violation.file).replaceAll("\\", "/")}:${violation.type} (${violation.count})`);
	}
}

if (failures === 0) {
	console.log(
		`Component contract checks passed (${byBasename.size} basenames unique, ${designFiles.length} files referenced).`,
	);
} else {
	console.error(`\n[check:components] ${failures} violation(s) found.`);
	process.exitCode = 1;
}
