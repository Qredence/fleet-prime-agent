import { getPrimeConfig } from "../prime-config";
import { cwdForRequest } from "../project-request";
import { wrapApiHandler } from "../wrap-api-handler";

function packageSourceToString(source: string | { source: string; [key: string]: unknown }): {
	name: string;
	description?: string;
} {
	if (typeof source === "string") return { name: source };
	return {
		name: source.source,
		description: Object.entries(source)
			.flatMap(([k, v]) => (k === "source" ? [] : [`${k}=${JSON.stringify(v)}`]))
			.join(" "),
	};
}

export function handleChatResourcesGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const cwd = await cwdForRequest(request);
		const config = getPrimeConfig();
		const settings = config.settingsFor(cwd);
		const loader = await config.resourceLoaderFor(cwd);

		const skillsResult = loader.getSkills();
		const promptsResult = loader.getPrompts();
		const themesResult = loader.getThemes();
		const extensionsResult = loader.getExtensions();
		const agentsFilesResult = loader.getAgentsFiles();

		const diagnostics: string[] = [
			...skillsResult.diagnostics.map((d) => d.message),
			...promptsResult.diagnostics.map((d) => d.message),
			...themesResult.diagnostics.map((d) => d.message),
			...extensionsResult.errors.map((e) => `${e.path}: ${e.error}`),
		];

		return Response.json({
			packages: settings.getPackages().map(packageSourceToString),
			skills: skillsResult.skills.map((s) => ({
				name: s.name,
				description: s.description,
				path: s.filePath,
				source: s.sourceInfo?.source,
				installedInWorkspace: true,
			})),
			prompts: promptsResult.prompts.map((p) => ({
				name: p.name,
				description: p.description,
				argumentHint: p.argumentHint,
				path: p.filePath,
				source: p.sourceInfo?.source,
			})),
			extensions: extensionsResult.extensions.map((e) => ({
				name: e.path ?? "extension",
				path: e.path,
				activationStatus: "active" as const,
			})),
			themes: themesResult.themes.map((t) => ({
				name: t.name ?? "theme",
				path: t.sourcePath,
			})),
			agentsFiles: agentsFilesResult.agentsFiles.map((a) => ({
				name: a.path,
				path: a.path,
			})),
			diagnostics,
		});
	});
}
