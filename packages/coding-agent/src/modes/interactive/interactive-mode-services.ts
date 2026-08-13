import type { AgentSession } from "../../core/agent-session.js";
import type { AgentSessionServices } from "../../core/agent-session-services.js";
import type { ModelRegistry } from "../../core/model-registry.js";
import type { SessionManager } from "../../core/session-manager.js";
import type { SettingsManager } from "../../core/settings-manager.js";
import type { Theme } from "./theme/theme.js";

/**
 * Local UI services that are intentionally separate from AgentConnection.
 *
 * These services cover client-local concerns such as settings, auth/model
 * registry access, and theme registration. They are not execution ownership and
 * should not be used to reach back into AgentSessionRuntime or AgentSession.
 */
export interface InteractiveModeUiServices {
	settingsManager: SettingsManager;
	modelRegistry: ModelRegistry;
	getInitialCwd(): string;
	getInitialSessionName(): string | undefined;
	getThemes(): Theme[];
}

export function createInteractiveModeUiServices(getSession: () => AgentSession): InteractiveModeUiServices {
	return {
		get settingsManager() {
			return getSession().settingsManager;
		},
		get modelRegistry() {
			return getSession().modelRegistry;
		},
		getInitialCwd: () => getSession().sessionManager.getCwd(),
		getInitialSessionName: () => getSession().sessionManager.getSessionName(),
		getThemes: () => getSession().resourceLoader.getThemes().themes,
	};
}

export function createInteractiveModeUiServicesFromServices(options: {
	services: AgentSessionServices;
	sessionManager: SessionManager;
}): InteractiveModeUiServices {
	const { services, sessionManager } = options;

	return {
		settingsManager: services.settingsManager,
		modelRegistry: services.modelRegistry,
		getInitialCwd: () => sessionManager.getCwd(),
		getInitialSessionName: () => sessionManager.getSessionName(),
		getThemes: () => services.resourceLoader.getThemes().themes,
	};
}
