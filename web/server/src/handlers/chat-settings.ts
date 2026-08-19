import { ChatSettingsUpdateRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { getPrimeConfig } from "../prime-config";
import { safePathLabel } from "../project-registry";
import { cwdForRequest } from "../project-request";
import { wrapApiHandler } from "../wrap-api-handler";

type PrimeSettings = ReturnType<ReturnType<typeof getPrimeConfig>["defaultSettings"]["getGlobalSettings"]>;

function toProjectShape(project: PrimeSettings) {
	const out: Record<string, unknown> = {};
	if (project.compaction) out.compaction = project.compaction;
	if (project.defaultModel !== undefined) out.defaultModel = project.defaultModel;
	if (project.defaultProvider !== undefined) out.defaultProvider = project.defaultProvider;
	if (project.defaultThinkingLevel !== undefined) out.defaultThinkingLevel = project.defaultThinkingLevel;
	if (project.enableSkillCommands !== undefined) out.enableSkillCommands = project.enableSkillCommands;
	if (project.enabledModels !== undefined) out.enabledModels = project.enabledModels;
	if (project.extensions !== undefined) out.extensions = project.extensions;
	if (project.followUpMode !== undefined) out.followUpMode = project.followUpMode;
	if (project.packages !== undefined) out.packages = project.packages;
	if (project.prompts !== undefined) out.prompts = project.prompts;
	if (project.retry) out.retry = project.retry;
	if (project.skills !== undefined) out.skills = project.skills;
	if (project.steeringMode !== undefined) out.steeringMode = project.steeringMode;
	if (project.themes !== undefined) out.themes = project.themes;
	if (project.transport !== undefined) out.transport = project.transport;
	return out;
}

function buildResponse(cwd: string) {
	const config = getPrimeConfig();
	const manager = config.settingsFor(cwd);
	const globalSettings = manager.getGlobalSettings();
	const projectSettings = manager.getProjectSettings();

	const compaction = manager.getCompactionSettings();
	const retry = manager.getRetrySettings();
	const merged: PrimeSettings = { ...globalSettings, ...projectSettings };

	return {
		diagnostics: [] as string[],
		effective: {
			compaction: {
				enabled: compaction.enabled,
				reserveTokens: compaction.reserveTokens,
				keepRecentTokens: compaction.keepRecentTokens,
			},
			defaultModel: merged.defaultModel,
			defaultProvider: merged.defaultProvider,
			defaultThinkingLevel: merged.defaultThinkingLevel,
			enableSkillCommands: manager.getEnableSkillCommands(),
			enabledModels: manager.getEnabledModels(),
			extensions: manager.getExtensionPaths(),
			followUpMode: manager.getFollowUpMode(),
			packages: manager.getPackages(),
			prompts: manager.getPromptTemplatePaths(),
			retry: {
				enabled: retry.enabled,
				maxRetries: retry.maxRetries,
				baseDelayMs: retry.baseDelayMs,
			},
			skills: manager.getSkillPaths(),
			steeringMode: manager.getSteeringMode(),
			themes: manager.getThemePaths(),
			transport: manager.getTransport(),
		},
		project: toProjectShape(projectSettings),
		projectPath: safePathLabel(cwd),
		updateImpact: {
			newSessionRecommended: false,
			resourceReloadRequired: false,
		},
	};
}

export function handleChatSettingsGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const cwd = await cwdForRequest(request);
		return Response.json(buildResponse(cwd));
	});
}

export function handleChatSettingsPatch(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const [cwd, raw] = await Promise.all([cwdForRequest(request), request.json().catch(() => ({}))]);
		const body = ChatSettingsUpdateRequestSchema.parse(raw);
		const config = getPrimeConfig();
		const manager = config.settingsFor(cwd);

		const patch = body.settings;
		if (patch.defaultProvider !== undefined) {
			manager.setDefaultProvider(patch.defaultProvider);
		}
		if (patch.defaultModel !== undefined && patch.defaultProvider !== undefined) {
			manager.setDefaultModelAndProvider(patch.defaultProvider, patch.defaultModel);
		} else if (patch.defaultModel !== undefined) {
			manager.setDefaultModel(patch.defaultModel);
		}
		if (patch.defaultThinkingLevel !== undefined) {
			manager.setDefaultThinkingLevel(patch.defaultThinkingLevel);
		}
		if (patch.transport !== undefined) {
			manager.setTransport(patch.transport);
		}
		if (patch.steeringMode !== undefined) {
			manager.setSteeringMode(patch.steeringMode);
		}
		if (patch.followUpMode !== undefined) {
			manager.setFollowUpMode(patch.followUpMode);
		}
		if (patch.enableSkillCommands !== undefined) {
			manager.setEnableSkillCommands(patch.enableSkillCommands);
		}
		if (patch.enabledModels !== undefined) {
			manager.setEnabledModels(patch.enabledModels ?? undefined);
		}
		if (patch.compaction?.enabled !== undefined) {
			manager.setCompactionEnabled(patch.compaction.enabled);
		}
		if (patch.retry?.enabled !== undefined) {
			manager.setRetryEnabled(patch.retry.enabled);
		}
		if (patch.extensions !== undefined) {
			manager.setExtensionPaths(patch.extensions);
		}
		if (patch.skills !== undefined) {
			manager.setSkillPaths(patch.skills);
		}
		if (patch.prompts !== undefined) {
			manager.setPromptTemplatePaths(patch.prompts);
		}
		if (patch.themes !== undefined) {
			manager.setThemePaths(patch.themes);
		}
		if (patch.packages !== undefined) {
			manager.setPackages(patch.packages as never);
		}

		return Response.json(buildResponse(cwd));
	});
}
