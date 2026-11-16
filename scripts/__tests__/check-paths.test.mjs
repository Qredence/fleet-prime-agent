import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatPaths, lintPaths } from "../check-paths.mjs";

test("formatting covers app scripts, Playwright sources, and all workspace config filenames", () => {
	for (const pattern of [
		"web/*/scripts/**/*.ts",
		"web/*/scripts/**/*.tsx",
		"web/*/scripts/**/*.mjs",
		"web/app/playwright/**/*.ts",
		"web/*/*.config.{ts,mts,cts,js,mjs,cjs}",
	]) {
		assert.ok(formatPaths.includes(pattern), pattern);
	}
	const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
	assert.equal(manifest.scripts.format, "node scripts/check.mjs --write");
});

test("lint uses concrete workspace config files rather than unexpanded globs", () => {
	const root = mkdtempSync(join(tmpdir(), "fleet-check-paths-"));
	try {
		for (const name of ["app", "server", "protocol"]) mkdirSync(join(root, "web", name), { recursive: true });
		for (const file of [
			"web/app/vite.config.ts",
			"web/app/vitest.bench.config.ts",
			"web/server/vitest.config.ts",
			"web/protocol/custom.config.mjs",
			"web/app/tsconfig.json",
		])
			writeFileSync(join(root, file), "");
		const paths = lintPaths(root);
		for (const file of [
			"web/app/scripts",
			"web/app/playwright",
			"web/server/scripts",
			"web/app/vite.config.ts",
			"web/app/vitest.bench.config.ts",
			"web/server/vitest.config.ts",
			"web/protocol/custom.config.mjs",
		])
			assert.ok(paths.includes(file), file);
		assert.ok(!paths.includes("web/app/tsconfig.json"));
		assert.ok(paths.every((path) => !path.includes("*")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
