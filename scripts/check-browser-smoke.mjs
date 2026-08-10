import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const outputPath = join(tmpdir(), "pi-browser-smoke.js");
const errorLogPath = join(tmpdir(), "pi-browser-smoke-errors.log");

	try {
		await build({
			entryPoints: ["scripts/browser-smoke-entry.ts"],
			bundle: true,
			platform: "browser",
			format: "esm",
			// @mistralai/mistralai's ESM build statically imports @opentelemetry/api
			// but only calls it behind a feature flag; we don't use telemetry in the
			// browser smoke bundle, so mark the import as external to let esbuild
			// skip resolving it. This is also how the upstream Mistral SDK is intended
			// to be bundled for browsers.
			external: ["@opentelemetry/api"],
			logLevel: "silent",
			outfile: outputPath,
		});
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
