import { join } from "node:path";
import { ChatSettingsUpdateRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { applySettingsPatch } from "../agent-settings-writer";
import { getPrimeConfig } from "../prime-config";
import { safePathLabel } from "../project-registry";
import { cwdForRequest } from "../project-request";
import { mergeProjectedSettings, projectSettingsValues, readSettingsProjection } from "../settings-projection";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

/**
 * Settings writes go to the project file when one already exists, matching the
 * runtime's own resolution order, and to the global file otherwise. A request
 * that carried a project therefore edits that project's settings, but never
 * creates a project-level file to hold a change the user expected globally.
 */
async function settingsWritePath(request: Request): Promise<{ path: string; scope: "global" | "project" }> {
	const config = getPrimeConfig();
	const cwd = await cwdForRequest(request);
	const project = await readSettingsProjection(config.agentDir, cwd);
	if (Object.keys(project.project).length > 0) {
		return { path: join(cwd, ".prime", "agent", "settings.json"), scope: "project" };
	}
	return { path: join(config.agentDir, "settings.json"), scope: "global" };
}

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
		const body = ChatSettingsUpdateRequestSchema.parse(await request.json().catch(() => ({})));
		const cwd = await cwdForRequest(request);
		const { path } = await settingsWritePath(request);

		const outcome = await applySettingsPatch(path, body.settings);
		if (outcome.status === "refused") {
			return Response.json(
				{
					code: "UNWRITABLE",
					message: `Fleet could not update ${safePathLabel(path)}. ${outcome.reason} Change these settings in the Prime Agent terminal interface instead.`,
				},
				{ status: 409 },
			);
		}
		getPrimeConfig().invalidateSettings();

		// The runtime reads settings at session start and on reload, so a write is
		// not observable until one of those happens. A reload is cheap; failing it
		// must not report the write as unsuccessful.
		if (outcome.impact.resourceReloadRequired) {
			await getBridge()
				.reloadResources()
				.catch(() => undefined);
		}

		const response = await buildResponse(cwd);
		return Response.json({ ...response, updateImpact: outcome.impact });
	}, request);
}
