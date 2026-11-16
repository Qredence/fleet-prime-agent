import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const outputDir = mkdtempSync(join(tmpdir(), "pi-browser-smoke-"));
const outputPath = join(outputDir, "bundle.js");
const errorLogPath = join(outputDir, "errors.log");

// @earendil-works/* only exist under web/server (pnpm isolation), never at
// the repo root, so the bundler needs that lookup path to resolve them.
const serverModules = resolve(import.meta.dirname, "..", "web", "server", "node_modules");

try {
	const result = await build({
		entryPoints: ["scripts/browser-smoke-entry.ts"],
		bundle: true,
		platform: "browser",
		format: "esm",
		treeShaking: false,
		metafile: true,
		external: ["@opentelemetry/api"],
		nodePaths: [serverModules],
		logLevel: "silent",
		outfile: outputPath,
	});
	// The public protocol barrel must stay browser-safe even without tree shaking.
	const leaks = Object.keys(result.metafile.inputs).filter((file) =>
		/(?:^|\/)web\/server\/src\/|@openuidev(?:\+|\/)lang-core/.test(file),
	);
	if (leaks.length > 0) throw new Error(`Browser protocol imports server/prompt implementation: ${leaks.join(", ")}`);
	process.exit(0);
} catch (error) {
	let detailedErrors = "";
	if (error && typeof error === "object" && "errors" in error && Array.isArray(error.errors)) {
		detailedErrors = error.errors
			.map((entry) => {
				const location = entry.location
					? `${entry.location.file}:${entry.location.line}:${entry.location.column}`
					: "";
				return [location, entry.text].filter(Boolean).join(" ");
			})
			.join("\n");
	}

	const baseError = error instanceof Error ? (error.stack ?? error.message) : String(error);
	writeFileSync(errorLogPath, [detailedErrors, baseError].filter(Boolean).join("\n\n"), "utf-8");
	console.error(`Browser smoke check failed. See ${errorLogPath}`);
	process.exit(1);
}
