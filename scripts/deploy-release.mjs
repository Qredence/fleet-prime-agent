#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { promoteRelease } from "./rollback-release.mjs";

async function main() {
	const result = await promoteRelease({
		currentVersion: process.env.DEPLOY_CURRENT_VERSION,
		targetVersion: process.env.DEPLOY_TARGET_VERSION,
	});
	console.log(`Moved @qredence/fleet latest from ${result.currentVersion} to ${result.targetVersion}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
