/**
 * Fleet product preferences.
 *
 * Fleet-owned state lives beside the runtime's own files rather than inside
 * them: `ARCHITECTURE.md` gives runtime/provider configuration to Prime Agent,
 * so a Fleet preference must not be written into the runtime's settings. This
 * mirrors how `project-registry.ts` persists `fleet-projects.json`.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type FleetSettings = {
	version: 1;
	/** Whether composer drafts may be sent to the optional intent classifier. */
	composerIntentEnabled: boolean;
};

/**
 * Off by default. Composer drafts are user text and can contain anything, so
 * the feature is only ever enabled by an explicit user action in Settings.
 */
export const DEFAULT_FLEET_SETTINGS: FleetSettings = {
	version: 1,
	composerIntentEnabled: false,
};

export const FLEET_SETTINGS_FILE = "fleet-settings.json";

export function fleetSettingsPath(agentDir: string): string {
	return join(agentDir, FLEET_SETTINGS_FILE);
}

/** Reads the settings file, falling back to defaults when it is missing or corrupt. */
export async function readFleetSettings(agentDir: string): Promise<FleetSettings> {
	try {
		const raw = JSON.parse(await readFile(fleetSettingsPath(agentDir), "utf8")) as Partial<FleetSettings>;
		return {
			version: 1,
			composerIntentEnabled: raw.composerIntentEnabled === true,
		};
	} catch {
		return { ...DEFAULT_FLEET_SETTINGS };
	}
}

/**
 * Serializes writes within this process.
 *
 * The read-merge-write sequence is not atomic on its own, so two concurrent
 * updates could each read the old value and the second would silently drop the
 * first. Chaining them costs nothing at this size and removes that window.
 */
let writeChain: Promise<unknown> = Promise.resolve();

/** Merges a patch into the settings file, writing via a temporary file. */
export async function updateFleetSettings(
	agentDir: string,
	patch: Partial<Omit<FleetSettings, "version">>,
): Promise<FleetSettings> {
	const update = writeChain.then(() => writeFleetSettings(agentDir, patch));
	// Keep the chain alive even if this update rejects.
	writeChain = update.catch(() => undefined);
	return update;
}

async function writeFleetSettings(
	agentDir: string,
	patch: Partial<Omit<FleetSettings, "version">>,
): Promise<FleetSettings> {
	const current = await readFleetSettings(agentDir);
	const next: FleetSettings = {
		version: 1,
		composerIntentEnabled: patch.composerIntentEnabled ?? current.composerIntentEnabled,
	};
	const path = fleetSettingsPath(agentDir);
	await mkdir(dirname(path), { recursive: true });
	// Unique per write: a shared name lets one writer rename the file out from
	// under another, which surfaces as ENOENT on the loser.
	const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
	await rename(temporary, path);
	return next;
}
