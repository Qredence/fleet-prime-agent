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
 * Pinned on `globalThis` for the same reason as the bridge singleton: Vite's
 * SSR full-module restarts must not drop in-memory caches or trigger re-reads
 * of sensitive files mid-request.
 */

import { resolve } from "node:path";
import { AuthStorage, DefaultResourceLoader, getAgentDir, ModelRegistry, SettingsManager } from "prime-agent";
import { ProjectRegistry } from "./project-registry";
import { resolveDefaultWorkspaceRoot } from "./workspace-root";

export interface PrimeConfig {
	readonly authStorage: AuthStorage;
	readonly modelRegistry: ModelRegistry;
	readonly defaultSettings: SettingsManager;
	readonly defaultCwd: string;
	readonly agentDir: string;
	readonly projectRegistry: ProjectRegistry;

	/** SettingsManager bound to a given cwd (one per unique cwd). */
	settingsFor(cwd: string): SettingsManager;
	/** ResourceLoader bound to a given cwd (reloaded on every call). */
	resourceLoaderFor(cwd: string): Promise<DefaultResourceLoader>;

	/**
	 * Rebind the process-wide workspace / agent root (`defaultCwd`).
	 * Used by "Open project folder" — tree, file APIs, and new sessions follow.
	 */
	setDefaultCwd(cwd: string): void;

	/** Force reload of AuthStorage/ModelRegistry from disk (after a POST/DELETE). */
	reloadAuth(): void;
}

type PrimeConfigGlobal = { __primeConfig?: PrimeConfig };

function createPrimeConfig(initialCwd: string): PrimeConfig {
	const agentDir = getAgentDir();
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const projectRegistry = new ProjectRegistry(agentDir, initialCwd);

	let currentDefaultCwd = resolve(initialCwd);
	let defaultSettings = SettingsManager.create(currentDefaultCwd);

	const settingsByCwd = new Map<string, SettingsManager>();
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

		settingsFor(cwd: string): SettingsManager {
			if (cwd === currentDefaultCwd) return defaultSettings;
			const existing = settingsByCwd.get(cwd);
			if (existing) return existing;
			const created = SettingsManager.create(cwd);
			settingsByCwd.set(cwd, created);
			return created;
		},

		async resourceLoaderFor(cwd: string): Promise<DefaultResourceLoader> {
			const settings = this.settingsFor(cwd);
			const loader = new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager: settings,
			});
			await loader.reload();
			return loader;
		},

		setDefaultCwd(cwd: string): void {
			const next = resolve(cwd);
			currentDefaultCwd = next;
			const existing = settingsByCwd.get(next);
			if (existing) {
				defaultSettings = existing;
				return;
			}
			defaultSettings = SettingsManager.create(next);
			settingsByCwd.set(next, defaultSettings);
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
	if (!existing || typeof existing.setDefaultCwd !== "function" || !existing.projectRegistry) {
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
