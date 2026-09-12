#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseStableVersion } from "./release-utils.mjs";
import { readRegistryMetadata } from "./rollback-release.mjs";

export const ROLLBACK_DEPLOY_NAME = "fleet-rollback";
export const ROLLBACK_MARKER_STATE_PATH = ".circleci/rollback-marker.state.json";

const TERMINAL_STATUSES = new Set(["SUCCESS", "FAILED", "CANCELED"]);

export function rollbackMarkerArgs({ status, failureReason } = {}) {
	if (!TERMINAL_STATUSES.has(status)) {
		throw new Error(`Rollback marker status must be one of ${[...TERMINAL_STATUSES].join(", ")}`);
	}
	return [
		"run",
		"release",
		"update",
		ROLLBACK_DEPLOY_NAME,
		`--status=${status}`,
		...(status === "FAILED" && failureReason ? [`--failure-reason=${failureReason}`] : []),
	];
}

export function resolveRollbackMarker({
	requestedStatus,
	currentVersion,
	targetVersion,
	latestVersion,
	failureReason,
} = {}) {
	if (!TERMINAL_STATUSES.has(requestedStatus)) {
		throw new Error(`Rollback marker status must be one of ${[...TERMINAL_STATUSES].join(", ")}`);
	}
	parseStableVersion(currentVersion);
	parseStableVersion(targetVersion);
	parseStableVersion(latestVersion);

	if (latestVersion === targetVersion) return { status: "SUCCESS" };
	if (latestVersion === currentVersion && requestedStatus === "CANCELED") return { status: "CANCELED" };
	if (latestVersion === currentVersion) {
		return { status: "FAILED", failureReason: failureReason ?? "npm dist-tag rollback did not change latest" };
	}
	return {
		status: "FAILED",
		failureReason: `${failureReason ? `${failureReason}; ` : ""}npm latest is ${latestVersion}; expected ${targetVersion} (rollback target) or ${currentVersion} (current version)`,
	};
}

function readMarkerState(statePath) {
	try {
		return JSON.parse(readFileSync(statePath, "utf8"));
	} catch (error) {
		if (error?.code === "ENOENT") return undefined;
		throw error;
	}
}

function writeMarkerState(statePath, state) {
	writeFileSync(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

function stateAlreadyAttempted(state) {
	return Boolean(state?.attempted);
}

function isTerminalMarkerError(error) {
	return /terminal|already.*(?:success|failed|canceled)|cannot update.*(?:success|failed|canceled)/i.test(
		error instanceof Error ? error.message : String(error),
	);
}

/**
 * Reconciles npm latest before recording a rollback marker terminal status.
 * The state file prevents a second terminal update after an uncertain command result.
 */
export async function reconcileRollbackMarker({
	currentVersion,
	targetVersion,
	requestedStatus,
	failureReason = "npm dist-tag rollback failed",
	fetchImpl = fetch,
	execImpl = (args) => execFileSync("circleci", args, { stdio: "inherit" }),
	statePath = ROLLBACK_MARKER_STATE_PATH,
} = {}) {
	const previousState = readMarkerState(statePath);
	if (stateAlreadyAttempted(previousState)) {
		return {
			status: previousState.status,
			latestVersion: previousState.latestVersion,
			skipped: true,
		};
	}

	if (!currentVersion || !targetVersion)
		throw new Error("Rollback marker reconciliation requires current and target versions");
	const metadata = await readRegistryMetadata({ fetchImpl });
	const latestVersion = metadata?.["dist-tags"]?.latest;
	if (!latestVersion) throw new Error("npm metadata has no latest dist-tag for @qredence/fleet");
	const resolution = resolveRollbackMarker({
		requestedStatus,
		currentVersion,
		targetVersion,
		latestVersion,
		failureReason,
	});

	try {
		await execImpl(rollbackMarkerArgs(resolution));
	} catch (error) {
		if (isTerminalMarkerError(error)) {
			writeMarkerState(statePath, {
				attempted: true,
				status: resolution.status,
				latestVersion,
				markerUpdateError: error instanceof Error ? error.message : String(error),
			});
		}
		throw error;
	}

	writeMarkerState(statePath, { attempted: true, status: resolution.status, latestVersion });
	if (requestedStatus === "SUCCESS" && resolution.status !== "SUCCESS") {
		throw new Error(`Rollback marker reconciled to ${resolution.status}; npm latest is ${latestVersion}`);
	}
	return { status: resolution.status, latestVersion, skipped: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const requestedStatus = process.argv[2];
	reconcileRollbackMarker({
		currentVersion: process.env.ROLLBACK_CURRENT_VERSION,
		targetVersion: process.env.ROLLBACK_TARGET_VERSION,
		requestedStatus,
		failureReason: process.env.ROLLBACK_FAILURE_REASON,
	})
		.then((result) => {
			if (result.skipped)
				console.log(`Rollback marker update skipped after prior ${result.status ?? "uncertain"} attempt.`);
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
