import type {
	ChatPackageSource,
	ChatPiSettings,
	ChatPiSettingsUpdate,
	ChatResourcesResponse,
} from "@prime-agent/web-protocol/chat-protocol";

export function modelSettings(settings: ChatPiSettings): ChatPiSettingsUpdate {
	return {
		defaultProvider: settings.defaultProvider,
		defaultModel: settings.defaultModel,
		defaultThinkingLevel: settings.defaultThinkingLevel,
		enabledModels: settings.enabledModels === undefined ? null : sanitizeStringList(settings.enabledModels),
	};
}

export function comparableModelSettings(
	settings:
		| Pick<ChatPiSettings, "defaultProvider" | "defaultModel" | "defaultThinkingLevel" | "enabledModels">
		| ChatPiSettingsUpdate,
): ChatPiSettingsUpdate {
	const enabledRaw = settings.enabledModels;
	const enabledModels =
		enabledRaw === undefined || enabledRaw === null ? null : [...sanitizeStringList(enabledRaw)].sort();

	return {
		defaultProvider: settings.defaultProvider,
		defaultModel: settings.defaultModel,
		defaultThinkingLevel: settings.defaultThinkingLevel,
		enabledModels,
	};
}

export function resourceSettings(settings: ChatPiSettings): ChatPiSettingsUpdate {
	return {
		packages: settings.packages,
		extensions: sanitizeStringList(settings.extensions),
		skills: sanitizeStringList(settings.skills),
		prompts: sanitizeStringList(settings.prompts),
		themes: sanitizeStringList(settings.themes),
		enableSkillCommands: settings.enableSkillCommands,
	};
}

export function sameJson(left: unknown, right: unknown) {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function summarizeResources(resources: ChatResourcesResponse | null) {
	const catalog = resources
		? [
				...resources.skills,
				...resources.prompts,
				...resources.extensions,
				...resources.packages,
				...resources.themes,
				...resources.agentsFiles,
			]
		: [];

	return {
		active: catalog.filter((item) => item.activationStatus === "active").length,
		staged: catalog.filter((item) => item.activationStatus === "staged").length,
		reloadRequired: catalog.filter((item) => item.activationStatus === "reload-required").length,
		diagnostics: resources?.diagnostics ?? [],
		total: catalog.length,
	};
}

export function formatPackageSourceRows(values: Array<ChatPackageSource>) {
	return values.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
}

export function parsePackageSourceRows(rows: Array<string>): Array<ChatPackageSource> {
	return rows
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			if (!line.startsWith("{")) return line;
			const parsed = JSON.parse(line) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("Package JSON entries must be objects.");
			}
			return parsed as Record<string, unknown>;
		});
}

export function sanitizeStringList(values: Array<string>) {
	return values.map((item) => item.trim()).filter(Boolean);
}
