#!/usr/bin/env node
// Standalone launcher for the Qredence web interface: equivalent to
// `prime-agent web`. The Node 22+ module graph fails at link time on older
// Node, so it must load behind the dynamic import, after the dependency-free
// guard runs (same as cli.ts).
import { assertNodeVersion } from "./cli/node-version-check.js";

const supported = assertNodeVersion({
	version: process.versions.node,
	log: console.error,
	exit: (code) => process.exit(code),
});

if (supported) {
	const { runWebCommand } = await import("./cli/web-command.js");
	await runWebCommand(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
