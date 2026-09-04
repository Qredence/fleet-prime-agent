#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const browserSourceRoots = ["web/app/src", "web/design/src"];
const forbiddenImportPattern =
	/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*|\bexport\s+[^;\n]*?\bfrom\s*)["'](prime-agent|@earendil-works\/pi-agent-core|@earendil-works\/pi-ai|@earendil-works\/pi-tui)(?:\/[^"']*)?["']/g;

function sourceFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules" && entry.name !== "dist") files.push(...sourceFiles(path));
			continue;
		}
		if (/\.(?:c|m)?[jt]sx?$/.test(entry.name)) files.push(path);
	}
	return files;
}

const violations = [];
for (const sourceRoot of browserSourceRoots) {
	for (const file of sourceFiles(resolve(root, sourceRoot))) {
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(forbiddenImportPattern)) {
			const line = source.slice(0, match.index).split("\n").length;
			violations.push(relative(root, file) + ":" + line + " imports " + match[1]);
		}
	}
}

if (violations.length > 0) {
	console.error("Browser packages must not import Prime Agent runtime packages directly:");
	for (const violation of violations) console.error("- " + violation);
	process.exit(1);
}

console.log("Browser/runtime import boundary passed.");
