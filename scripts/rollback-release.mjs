#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { compareVersions, NPM_REGISTRY, parseStableVersion } from "./release-utils.mjs";

export const PACKAGE_NAME = "@qredence/fleet";

function registryUrl() {
	return `${NPM_REGISTRY}${encodeURIComponent(PACKAGE_NAME)}`;
}

export async function readRegistryMetadata({ fetchImpl = fetch } = {}) {
	const response = await fetchImpl(registryUrl(), {
		headers: { Accept: "application/json" },
	});
	if (response.status === 404) throw new Error(`${PACKAGE_NAME} is not published`);
	if (!response.ok) throw new Error(`npm registry metadata lookup failed with HTTP ${response.status}`);
	return response.json();
}

/**
 * Validates the optimistic-concurrency and immutable-version rules for a latest-tag move.
 * @param {object} options
 * @param {string} options.currentVersion - Version CircleCI recorded as deployed.
 * @param {string} options.targetVersion - Version selected for rollback.
 * @param {string} options.latestVersion - Version currently assigned to npm latest.
 * @param {object|undefined} options.targetMetadata - Published npm metadata for the target version.
 * @returns {{currentVersion: string, targetVersion: string}}
 */
export function validateLatestTagMove({
	currentVersion,
	targetVersion,
	latestVersion,
	targetMetadata,
	requireOlder = false,
}) {
	parseStableVersion(currentVersion);
	parseStableVersion(targetVersion);
	parseStableVersion(latestVersion);
	if (latestVersion !== currentVersion) {
		throw new Error(
			`Refusing rollback: npm latest is ${latestVersion}, but CircleCI expected ${currentVersion}; a newer deployment may have started.`,
		);
	}
	if (targetVersion === currentVersion) {
		throw new Error(`Refusing npm latest update: target version ${targetVersion} is already active`);
	}
	if (requireOlder && compareVersions(targetVersion, currentVersion) >= 0) {
		throw new Error(`Refusing rollback: target version ${targetVersion} is not older than ${currentVersion}`);
	}
	if (!targetMetadata || targetMetadata.version !== targetVersion) {
		throw new Error(`Refusing rollback: ${PACKAGE_NAME}@${targetVersion} is not published`);
	}
	return { currentVersion, targetVersion };
}

export function validateRollback(options) {
	return validateLatestTagMove({ ...options, requireOlder: true });
}

async function moveLatestTag({
	currentVersion,
	targetVersion,
	fetchImpl = fetch,
	distTagAddImpl = (version) =>
		execFileSync("npm", ["dist-tag", "add", `${PACKAGE_NAME}@${version}`, "latest"], { stdio: "inherit" }),
	requireOlder,
	dryRun = false,
	missingMessage,
}) {
	if (!currentVersion || !targetVersion) throw new Error(missingMessage);
	const metadata = await readRegistryMetadata({ fetchImpl });
	const latestVersion = metadata?.["dist-tags"]?.latest;
	if (!latestVersion) throw new Error(`npm metadata has no latest dist-tag for ${PACKAGE_NAME}`);
	const targetMetadata = metadata?.versions?.[targetVersion];
	const result = validateLatestTagMove({
		currentVersion,
		targetVersion,
		latestVersion,
		targetMetadata,
		requireOlder,
	});
	if (dryRun) {
		console.log(`Dry run: would move ${PACKAGE_NAME} latest from ${currentVersion} to ${targetVersion}.`);
	} else {
		await distTagAddImpl(targetVersion);
	}
	return result;
}

/**
 * Verifies the selected npm version and moves only the latest dist-tag.
 * @param {object} options
 * @param {string} options.currentVersion - Version CircleCI recorded as deployed.
 * @param {string} options.targetVersion - Version selected for rollback.
 * @param {Function} [options.fetchImpl=fetch] - Registry metadata implementation.
 * @param {Function} [options.distTagAddImpl] - Mutation implementation.
 * @returns {Promise<{currentVersion: string, targetVersion: string}>}
 */
export async function rollbackRelease({
	currentVersion,
	targetVersion,
	fetchImpl = fetch,
	distTagAddImpl = (version) =>
		execFileSync("npm", ["dist-tag", "add", `${PACKAGE_NAME}@${version}`, "latest"], { stdio: "inherit" }),
	dryRun = false,
} = {}) {
	return moveLatestTag({
		currentVersion,
		targetVersion,
		fetchImpl,
		distTagAddImpl,
		requireOlder: true,
		dryRun,
		missingMessage: "Rollback requires current and target versions",
	});
}

export async function promoteRelease({
	currentVersion,
	targetVersion,
	fetchImpl = fetch,
	distTagAddImpl = (version) =>
		execFileSync("npm", ["dist-tag", "add", `${PACKAGE_NAME}@${version}`, "latest"], { stdio: "inherit" }),
	dryRun = false,
} = {}) {
	return moveLatestTag({
		currentVersion,
		targetVersion,
		fetchImpl,
		distTagAddImpl,
		requireOlder: false,
		dryRun,
		missingMessage: "Promotion requires current and target versions",
	});
}

async function main() {
	const result = await rollbackRelease({
		currentVersion: process.env.ROLLBACK_CURRENT_VERSION,
		targetVersion: process.env.ROLLBACK_TARGET_VERSION,
		dryRun: process.env.ROLLBACK_DRY_RUN === "1",
	});
	if (process.env.ROLLBACK_DRY_RUN === "1") {
		console.log(
			`Dry run complete: ${PACKAGE_NAME} latest would move from ${result.currentVersion} to ${result.targetVersion}.`,
		);
	} else {
		console.log(`Moved ${PACKAGE_NAME} latest from ${result.currentVersion} to ${result.targetVersion}.`);
	}
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
