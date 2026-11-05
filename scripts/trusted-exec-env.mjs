import { execFileSync, spawnSync } from "node:child_process";
import { delimiter, dirname } from "node:path";

const TRUSTED_PATH_ENTRIES =
	process.platform === "win32" ? [] : ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"];

/**
 * Directory containing the Node binary running this script (npm/pnpm live alongside it).
 * @returns {string}
 */
function nodeToolchainBinDir() {
	return dirname(process.execPath);
}

/**
 * PATH entries that are not user-writable in normal CI and developer images.
 * Used for release and verification scripts so spawned tools resolve predictably.
 * @returns {string} Delimited PATH for Unix, or the current PATH on Windows.
 */
export function trustedPathString() {
	if (TRUSTED_PATH_ENTRIES.length === 0) return process.env.PATH ?? "";
	const entries = [nodeToolchainBinDir(), ...TRUSTED_PATH_ENTRIES];
	const seen = new Set();
	const unique = [];
	for (const entry of entries) {
		if (!entry || seen.has(entry)) continue;
		seen.add(entry);
		unique.push(entry);
	}
	return unique.join(delimiter);
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

const TRUSTED_COMMANDS = new Set([
	"git",
	"npm",
	"pnpm",
	"circleci",
	"tar",
	"sh",
	"/bin/sh",
	"/usr/bin/tar",
	"/usr/bin/git",
	"/usr/bin/npm",
]);

/**
 * @param {string} file - Executable path or name resolved via trusted PATH.
 * @param {string[]} args - Arguments passed to the executable.
 * @param {import("node:child_process").ExecFileSyncOptionsWithStringEncoding} [options] - execFileSync options.
 * @returns {string} Command stdout when encoding is utf8.
 */
function assertTrustedCommand(file) {
	if (file === process.execPath || TRUSTED_COMMANDS.has(file)) return;
	if (typeof file === "string" && file.startsWith("/") && !/[\0\r\n]/.test(file)) return;
	throw new Error(`Refusing to spawn untrusted command: ${file}`);
}

export function execFileTrusted(file, args, options = {}) {
	assertTrustedCommand(file);
	const { env: envOverrides, ...rest } = options;
	const execOptions = { ...rest, env: trustedProcessEnv(envOverrides) };
	// Arguments are built by repository scripts, not request input. Sonar still treats the parameter as tainted.
	return execFileSync(file, args, execOptions); // NOSONAR
}

/**
 * @param {string} file - Executable path or name resolved via trusted PATH.
 * @param {string[]} args - Arguments passed to the executable.
 * @param {import("node:child_process").SpawnSyncOptionsWithStringEncoding} [options] - spawnSync options.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Spawn result.
 */
export function spawnSyncTrusted(file, args, options = {}) {
	assertTrustedCommand(file);
	const { env: envOverrides, ...rest } = options;
	return spawnSync(file, args, {
		...rest,
		env: trustedProcessEnv(envOverrides),
	});
}
