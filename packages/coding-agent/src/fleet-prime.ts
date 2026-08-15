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
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Launch the Qredence web interface (frontend and backend).

Usage:
  fleet-prime [--host <host>] [--port <port>] [--cwd <directory>]

Options:
  --host <host>       Bind the web server (default: 127.0.0.1)
  --port <port>       Bind the web server port (default: 3000)
  --cwd <directory>   Use a specific workspace directory`);
		process.exit(0);
	}
	const { runWebCommand } = await import("./cli/web-command.js");
	await runWebCommand(args).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
