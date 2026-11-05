import { execFileSync, spawnSync } from "node:child_process";
import { delimiter } from "node:path";

const TRUSTED_PATH_ENTRIES =
	process.platform === "win32" ? [] : ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"];

/**
 * PATH entries that are not user-writable in normal CI and developer images.
 * Used for release and verification scripts so spawned tools resolve predictably.
 * @returns {string} Delimited PATH for Unix, or the current PATH on Windows.
 */
export function trustedPathString() {
	if (TRUSTED_PATH_ENTRIES.length === 0) return process.env.PATH ?? "";
	return TRUSTED_PATH_ENTRIES.join(delimiter);
}

/**
 * @param {NodeJS.ProcessEnv} [overrides] - Extra environment entries merged on top of the current process env.
 * @returns {NodeJS.ProcessEnv} Environment with a fixed PATH on Unix.
 */
export function trustedProcessEnv(overrides = {}) {
	const env = { ...process.env, ...overrides };
	if (TRUSTED_PATH_ENTRIES.length > 0) env.PATH = trustedPathString();
	return env;
}

/**
 * @param {string} file - Executable path or name resolved via trusted PATH.
 * @param {string[]} args - Arguments passed to the executable.
 * @param {import("node:child_process").ExecFileSyncOptionsWithStringEncoding} [options] - execFileSync options.
 * @returns {string} Command stdout when encoding is utf8.
 */
export function execFileTrusted(file, args, options = {}) {
	const { env: envOverrides, ...rest } = options;
	return execFileSync(file, args, {
		...rest,
		env: trustedProcessEnv(envOverrides),
	});
}

/**
 * @param {string} file - Executable path or name resolved via trusted PATH.
 * @param {string[]} args - Arguments passed to the executable.
 * @param {import("node:child_process").SpawnSyncOptionsWithStringEncoding} [options] - spawnSync options.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Spawn result.
 */
export function spawnSyncTrusted(file, args, options = {}) {
	const { env: envOverrides, ...rest } = options;
	return spawnSync(file, args, {
		...rest,
		env: trustedProcessEnv(envOverrides),
	});
}
