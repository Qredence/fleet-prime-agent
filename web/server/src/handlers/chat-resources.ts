import { getPrimeConfig } from "../prime-config";
import { cwdForRequest } from "../project-request";
import { wrapApiHandler } from "../wrap-api-handler";
import { getBridge } from "../singleton";
import type { ChatResourceInfo } from "@prime-agent/web-protocol/chat-protocol";
import { requireSession } from "./session-access";

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
		const sessionId = new URL(request.url).searchParams.get("sessionId");
		const session = sessionId ? await requireSession(sessionId, { resume: false }) : undefined;
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
		const skills: ChatResourceInfo[] = skillsResult.skills.map((skill) => ({
			name: skill.name,
			description: skill.description,
			path: skill.filePath,
			source: skill.sourceInfo?.source,
			scope: skill.sourceInfo?.scope,
			origin: skill.sourceInfo?.origin,
			discoverySource: "legacy-discovery",
		}));
		const snapshot = session
			? await getBridge()
					.getResourceSnapshot(session.sessionId, cwd)
					.catch(() => {
						diagnostics.push("The session resource snapshot could not be read; showing discovery results.");
						return null;
					})
			: null;
		const snapshotState = !snapshot
			? "unavailable"
			: snapshot.skills.length || snapshot.prompts.length || snapshot.contextFiles.length
				? "available"
				: "empty";
		for (const skill of snapshot?.skills ?? []) {
			const projected: ChatResourceInfo = {
				name: skill.name,
				description: skill.description,
				path: skill.filePath,
				source: skill.sourceInfo.source,
				scope: skill.sourceInfo.scope,
				origin: skill.sourceInfo.origin === "topLevel" ? "top-level" : "package",
				loadedInSession: true,
				discoverySource: "daemon",
			};
			const index = skills.findIndex((candidate) => candidate.path === skill.filePath);
			if (index < 0) skills.push(projected);
			else skills[index] = projected;
		}
		for (const diagnostic of snapshot?.diagnostics.skills ?? []) {
			diagnostics.push(`${diagnostic.type}: ${diagnostic.message}${diagnostic.path ? ` (${diagnostic.path})` : ""}`);
		}

		return Response.json({
			snapshotState,
			packages: settings.getPackages().map(packageSourceToString),
			skills,
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
	}, request);
}
