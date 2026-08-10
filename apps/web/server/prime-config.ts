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
import {
	AuthStorage,
	DefaultResourceLoader,
	ModelRegistry,
	SettingsManager,
} from "@earendil-works/pi-coding-agent"
import { getAgentDir } from "@earendil-works/pi-coding-agent"

export interface PrimeConfig {
	readonly authStorage: AuthStorage
	readonly modelRegistry: ModelRegistry
	readonly defaultSettings: SettingsManager
	readonly defaultCwd: string
	readonly agentDir: string

	/** SettingsManager bound to a given cwd (one per unique cwd). */
	settingsFor(cwd: string): SettingsManager
	/** ResourceLoader bound to a given cwd (reloaded on every call). */
	resourceLoaderFor(cwd: string): Promise<DefaultResourceLoader>

	/** Force reload of AuthStorage/ModelRegistry from disk (after a POST/DELETE). */
	reloadAuth(): void
}

type PrimeConfigGlobal = { __primeConfig?: PrimeConfig }

function createPrimeConfig(defaultCwd: string): PrimeConfig {
	const agentDir = getAgentDir()
	const authStorage = AuthStorage.create()
	const modelRegistry = ModelRegistry.create(authStorage)
	const defaultSettings = SettingsManager.create(defaultCwd)

	const settingsByCwd = new Map<string, SettingsManager>()
	settingsByCwd.set(defaultCwd, defaultSettings)

	return {
		authStorage,
		modelRegistry,
		defaultSettings,
		defaultCwd,
		agentDir,

		settingsFor(cwd: string): SettingsManager {
			if (cwd === defaultCwd) return defaultSettings
			const existing = settingsByCwd.get(cwd)
			if (existing) return existing
			const created = SettingsManager.create(cwd)
			settingsByCwd.set(cwd, created)
			return created
		},

		async resourceLoaderFor(cwd: string): Promise<DefaultResourceLoader> {
			const settings = this.settingsFor(cwd)
			const loader = new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager: settings,
			})
			await loader.reload()
			return loader
		},

		reloadAuth(): void {
			this.authStorage.reload()
			this.modelRegistry.refresh()
		},
	}
}

export function getPrimeConfig(): PrimeConfig {
	const globalStore = globalThis as unknown as PrimeConfigGlobal
	if (!globalStore.__primeConfig) {
		globalStore.__primeConfig = createPrimeConfig(process.cwd())
	}
	return globalStore.__primeConfig
}

export function resetPrimeConfigForTests(): PrimeConfig {
	const globalStore = globalThis as unknown as PrimeConfigGlobal
	globalStore.__primeConfig = undefined
	return getPrimeConfig()
}
