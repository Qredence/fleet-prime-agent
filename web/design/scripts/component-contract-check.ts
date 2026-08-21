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

const DESIGN_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(DESIGN_ROOT, "..", "..");
const DESIGN_SRC = join(DESIGN_ROOT, "src");
const DESIGN_SCRIPTS = join(DESIGN_ROOT, "scripts");
const APP_SRC = resolve(DESIGN_ROOT, "..", "app", "src");

const ENTRY_EXEMPTIONS = new Set(["routeTree.gen.ts"]);
const NAME_CONVENTIONS = new Set(["index", "types", "utils", "cn", "index.test"]);

// ---------------------------------------------------------------------------
// doctor.config.jsonc waiver files (JSONC -> JSON with a comment-aware stripper)
// ---------------------------------------------------------------------------

function stripJsonComments(source: string): string {
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
		out += char;
	}
	return out;
}

function loadWaivedPaths(): Set<string> {
	const waived = new Set<string>();
	const configPath = join(REPO_ROOT, "doctor.config.jsonc");
	if (!existsSync(configPath)) return waived;
	try {
		const config = JSON.parse(stripJsonComments(readFileSync(configPath, "utf8"))) as unknown;
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
	return (
		!waived.has(designPath) && !waived.has(projectPath) && !waived.has(relativeToWeb)
	);
});
deadFiles.sort();

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

if (failures === 0) {
	console.log(
		`Component contract checks passed (${byBasename.size} basenames unique, ${designFiles.length} files referenced).`,
	);
} else {
	console.error(`\n[check:components] ${failures} violation(s) found.`);
	process.exitCode = 1;
}
