import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Shared by the read-only check and its explicit --write formatting mode.
export const formatPaths = [
	"packages/fleet-web/bin/**/*.mjs",
	"web/*/src/**/*.ts",
	"web/*/src/**/*.tsx",
	"web/*/scripts/**/*.ts",
	"web/*/scripts/**/*.tsx",
	"web/*/scripts/**/*.mjs",
	"web/app/playwright/**/*.ts",
	"web/*/*.config.{ts,mts,cts,js,mjs,cjs}",
	"scripts/**/*.mjs",
	"scripts/**/*.ts",
];

// Oxlint accepts directories and concrete files, not glob expressions.
export function lintPaths(root) {
	const configs = readdirSync(resolve(root, "web"), { withFileTypes: true }).flatMap((entry) => {
		if (!entry.isDirectory()) return [];
		const directory = `web/${entry.name}`;
		return readdirSync(resolve(root, directory))
			.filter((name) => /\.config\.[cm]?[jt]s$/.test(name))
			.map((name) => `${directory}/${name}`);
	});
	return [
		"packages/fleet-web/bin",
		"web/app/src",
		"web/protocol/src",
		"web/server/src",
		"web/app/scripts",
		"web/app/playwright",
		"web/server/scripts",
		"scripts",
		...configs,
	];
}
