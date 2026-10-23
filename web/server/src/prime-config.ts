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

import { resolve } from "node:path";
import {
	createLegacyAuthStorage,
	createLegacyModelRegistry,
	createLegacySettingsManager,
	type LegacyAuthStorage,
	type LegacyModelRegistry,
	type LegacyResourceLoader,
	type LegacySettingsManager,
	legacyAgentDir,
	loadLegacyResources,
} from "./legacy/prime-agent-sdk";
import { ProjectRegistry } from "./project-registry";
import { resolveDefaultWorkspaceRoot } from "./workspace-root";

export interface PrimeConfig {
	readonly authStorage: LegacyAuthStorage;
	readonly modelRegistry: LegacyModelRegistry;
	readonly defaultSettings: LegacySettingsManager;
	readonly defaultCwd: string;
	readonly agentDir: string;
	readonly projectRegistry: ProjectRegistry;

	/** SettingsManager bound to a given cwd (one per unique cwd). */
	settingsFor(cwd: string): LegacySettingsManager;
	/** ResourceLoader bound to a given cwd (reloaded on every call). */
	resourceLoaderFor(cwd: string): Promise<LegacyResourceLoader>;

	/** Force reload of AuthStorage/ModelRegistry from disk (after a POST/DELETE). */
	reloadAuth(): void;
}

type PrimeConfigGlobal = { __primeConfig?: PrimeConfig };

function createPrimeConfig(initialCwd: string): PrimeConfig {
	const agentDir = legacyAgentDir();
	const authStorage = createLegacyAuthStorage();
	const modelRegistry = createLegacyModelRegistry(authStorage);
	const projectRegistry = new ProjectRegistry(agentDir, initialCwd);

	const currentDefaultCwd = resolve(initialCwd);
	const defaultSettings = createLegacySettingsManager(currentDefaultCwd);

	const settingsByCwd = new Map<string, LegacySettingsManager>();
	settingsByCwd.set(currentDefaultCwd, defaultSettings);

	const config: PrimeConfig = {
		authStorage,
		modelRegistry,
		get defaultSettings() {
			return defaultSettings;
		},
		get defaultCwd() {
			return currentDefaultCwd;
		},
		agentDir,
		projectRegistry,

		settingsFor(cwd: string): LegacySettingsManager {
			if (cwd === currentDefaultCwd) return defaultSettings;
			const existing = settingsByCwd.get(cwd);
			if (existing) return existing;
			const created = createLegacySettingsManager(cwd);
			settingsByCwd.set(cwd, created);
			return created;
		},

		resourceLoaderFor(cwd: string): Promise<LegacyResourceLoader> {
			return loadLegacyResources({ cwd, agentDir, settingsManager: this.settingsFor(cwd) });
		},

		reloadAuth(): void {
			this.authStorage.reload();
			this.modelRegistry.refresh();
		},
	};

	return config;
}

export function getPrimeConfig(): PrimeConfig {
	const globalStore = globalThis as unknown as PrimeConfigGlobal;
	const existing = globalStore.__primeConfig;
	// Vite HMR can leave a pre-upgrade singleton without newer methods.
	if (!existing || !existing.projectRegistry) {
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
