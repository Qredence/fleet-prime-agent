#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isPackageVersionCommit } from "./publish-release.mjs";

const packageManifest = JSON.parse(
	readFileSync(new URL("../packages/fleet-web/package.json", import.meta.url), "utf8"),
);
const COMPONENT_NAME = "@qredence/fleet";
const ENVIRONMENT_NAME = "production";

export function releaseMarkerArgs({ action, status, version = packageManifest.version, failureReason } = {}) {
	if (action === "plan") {
		return [
			"run",
			"release",
			"plan",
			"fleet-release",
			`--environment-name=${ENVIRONMENT_NAME}`,
			`--component-name=${COMPONENT_NAME}`,
			`--target-version=${version}`,
		];
	}
	if (action === "update" && status) {
		return [
			"run",
			"release",
			"update",
			"fleet-release",
			`--status=${status}`,
			...(failureReason ? [`--failure-reason=${failureReason}`] : []),
		];
	}
	throw new Error("Release marker action must be plan or update with a status");
}

export function runReleaseMarker(
	action,
	options = {},
	{
		isVersionCommitImpl = isPackageVersionCommit,
		execImpl = (args) => execFileSync("circleci", args, { stdio: "inherit" }),
	} = {},
) {
	if (!isVersionCommitImpl()) {
		console.log("This commit does not version @qredence/fleet; deploy marker is a no-op.");
		return false;
	}
	execImpl(releaseMarkerArgs({ action, ...options }));
	return true;
}

const action = process.argv[2];
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		runReleaseMarker(action, {
			status: process.env.RELEASE_MARKER_STATUS,
			failureReason: process.env.RELEASE_MARKER_FAILURE_REASON,
		});
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
