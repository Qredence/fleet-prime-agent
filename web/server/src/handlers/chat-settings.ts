import { ChatSettingsUpdateRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { getPrimeConfig } from "../prime-config";
import { safePathLabel } from "../project-registry";
import { cwdForRequest } from "../project-request";
import { mergeProjectedSettings, projectSettingsValues, readSettingsProjection } from "../settings-projection";
import { wrapApiHandler } from "../wrap-api-handler";

async function buildResponse(cwd: string) {
	const config = getPrimeConfig();
	const projection = await readSettingsProjection(config.agentDir, cwd);
	const globalSettings = projectSettingsValues(projection.global);
	const projectSettings = projectSettingsValues(projection.project);
	const merged = mergeProjectedSettings(globalSettings, projectSettings);
	const compaction = merged.compaction as Record<string, unknown> | undefined;
	const retry = merged.retry as Record<string, unknown> | undefined;

	return {
		diagnostics: projection.diagnostics,
		effective: {
			compaction: {
				enabled: compaction?.enabled ?? true,
				reserveTokens: compaction?.reserveTokens ?? 16384,
				keepRecentTokens: compaction?.keepRecentTokens ?? 20000,
			},
			defaultModel: merged.defaultModel,
			defaultProvider: merged.defaultProvider,
			defaultThinkingLevel: merged.defaultThinkingLevel,
			enableSkillCommands: merged.enableSkillCommands ?? true,
			enabledModels: merged.enabledModels,
			extensions: merged.extensions ?? [],
			followUpMode: merged.followUpMode ?? "one-at-a-time",
			packages: merged.packages ?? [],
			prompts: merged.prompts ?? [],
			retry: {
				enabled: retry?.enabled ?? true,
				maxRetries: retry?.maxRetries ?? 3,
				baseDelayMs: retry?.baseDelayMs ?? 2000,
			},
			skills: merged.skills ?? [],
			steeringMode: merged.steeringMode ?? "one-at-a-time",
			themes: merged.themes ?? [],
			transport: merged.transport ?? "auto",
		},
		project: projectSettings,
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
		return Response.json(await buildResponse(cwd));
	}, request);
}

export function handleChatSettingsPatch(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		ChatSettingsUpdateRequestSchema.parse(await request.json().catch(() => ({})));
		return Response.json(
			{
				code: "UNSUPPORTED",
				message:
					"Fleet cannot safely update Prime Agent settings. Change them using the Prime Agent terminal interface.",
			},
			{ status: 501 },
		);
	}, request);
}
