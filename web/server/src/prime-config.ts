/**
 * Prime-agent configuration singletons — the single seam through which the web
 * server reaches `~/.prime/agent/{settings,auth,models}.json` and the resource
 * loaders (skills, prompts, extensions, themes, agents files).
 *
 * The bridge (`./prime-bridge.ts`) owns per-session `AgentSession` instances;
 * this module owns the *process-wide* configuration surface that those
 * sessions read from. Routes call `getPrimeConfig()` to get a cached
 * `AuthStorage` / `ModelRegistry`, and use `settingsFor(cwd)` for
 * cwd-scoped `SettingsManager` instances and `resourceLoaderFor(cwd)` for
 * skills/prompts/extensions/themes.
 *
 * The SDK classes themselves come from the R1b legacy bridge
 * (`./legacy/prime-agent-sdk.ts`), the only module allowed to import them.
 *
 * Pinned on `globalThis` for the same reason as the bridge singleton: Vite's
 * SSR full-module restarts must not drop in-memory caches or trigger re-reads
 * of sensitive files mid-request.
 */

import { join, resolve } from "node:path";
import { resolveAgentDir } from "./agent-dir";
import {
	createLegacyAuthStorage,
	createLegacySettingsManager,
	type LegacyAuthStorage,
	type LegacyResourceLoader,
	type LegacySettingsManager,
	loadLegacyResources,
} from "./legacy/prime-agent-sdk";
import { invalidateModelCatalog } from "./model-catalog-cache";
import { ProjectRegistry } from "./project-registry";
import { resolveDefaultWorkspaceRoot } from "./workspace-root";

export interface PrimeConfig {
	readonly authStorage: LegacyAuthStorage;
	readonly defaultSettings: LegacySettingsManager;
	readonly defaultCwd: string;
	readonly agentDir: string;
	readonly projectRegistry: ProjectRegistry;

	/** SettingsManager bound to a given cwd (one per unique cwd). */
	settingsFor(cwd: string): LegacySettingsManager;
	/** Drop cached settings after a settings file changes. */
	invalidateSettings(): void;
	/** ResourceLoader bound to a given cwd (reloaded on every call). */
	resourceLoaderFor(cwd: string): Promise<LegacyResourceLoader>;

	/** Force reload of AuthStorage from disk and drop the cached model catalog (after a POST/DELETE). */
	reloadAuth(): void;
}

type PrimeConfigGlobal = { __primeConfig?: PrimeConfig };

function createPrimeConfig(initialCwd: string): PrimeConfig {
	const agentDir = resolveAgentDir();
	const authStorage = createLegacyAuthStorage(join(agentDir, "auth.json"));
	const projectRegistry = new ProjectRegistry(agentDir, initialCwd);

	const currentDefaultCwd = resolve(initialCwd);
	const settingsByCwd = new Map<string, LegacySettingsManager>();
	settingsByCwd.set(currentDefaultCwd, createLegacySettingsManager(currentDefaultCwd, agentDir));

	const config: PrimeConfig = {
		authStorage,
		get defaultSettings() {
			return this.settingsFor(currentDefaultCwd);
		},
		get defaultCwd() {
			return currentDefaultCwd;
		},
		agentDir,
		projectRegistry,

		settingsFor(cwd: string): LegacySettingsManager {
			const existing = settingsByCwd.get(cwd);
			if (existing) return existing;
			const created = createLegacySettingsManager(cwd, agentDir);
			settingsByCwd.set(cwd, created);
			return created;
		},

		invalidateSettings(): void {
			settingsByCwd.clear();
		},

		resourceLoaderFor(cwd: string): Promise<LegacyResourceLoader> {
			return loadLegacyResources({ cwd, agentDir, settingsManager: this.settingsFor(cwd) });
		},

		reloadAuth(): void {
			this.authStorage.reload();
			// The daemon re-reads `auth.json` and `models.json` itself, so there is
			// no registry to refresh. Fleet's own catalog snapshot is what goes
			// stale after a write, so it is what gets dropped.
			invalidateModelCatalog();
		},
	};

	return config;
}

export function getPrimeConfig(): PrimeConfig {
	const globalStore = globalThis as unknown as PrimeConfigGlobal;
	const existing = globalStore.__primeConfig;
	// Vite HMR can leave a pre-upgrade singleton without newer methods.
	if (!existing || !existing.projectRegistry || !existing.invalidateSettings) {
		// Prefer git repo root over the Vite package cwd so the workspace tree
		// and default session cwd match the repository the agent is working in.
		// A pre-upgrade singleton always carries the stale Vite package cwd, so
		// the repo-root resolution runs unconditionally on recreate.
		globalStore.__primeConfig = createPrimeConfig(resolveDefaultWorkspaceRoot(process.cwd()));
	}
	return globalStore.__primeConfig!;
}

export function resetPrimeConfigForTests(): PrimeConfig {
	const globalStore = globalThis as unknown as PrimeConfigGlobal;
	globalStore.__primeConfig = undefined;
	return getPrimeConfig();
}
