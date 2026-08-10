import { createFileRoute } from "@tanstack/react-router"
import { wrapApiHandler } from "@/lib/api-utils"
import { getPrimeConfig } from "@/server/prime-config"

// GET /api/chat/resources — enumerate the resources prime-agent's
// DefaultResourceLoader can see for a given cwd. The frontend uses this to
// populate the "Resources" panel (Skills, Prompts, Extensions, Themes, Agent
// files, Packages). We surface the path-typed resource settings from
// SettingsManager AND the live-loaded display name/description from the
// loader's last reload.
//
// For v1 this runs a fresh loader per request — the cost is ~10ms on disk
// reads within `~/.prime/agent` + `<cwd>/.prime`, which is fine for an
// on-demand settings dialog. If this becomes a hot path we can cache per-cwd
// and expose an invalidation hook tied to SettingsManager change events.

function packageSourceToString(
	source: string | { source: string; [key: string]: unknown },
): { name: string; description?: string } {
	if (typeof source === "string") return { name: source }
	return {
		name: source.source,
		description: Object.entries(source)
			.filter(([k]) => k !== "source")
			.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
			.join(" "),
	}
}

export const Route = createFileRoute("/api/chat/resources")({
	server: {
		handlers: {
			GET: async ({ request }) =>
				wrapApiHandler(async () => {
					const url = new URL(request.url)
					const cwd = url.searchParams.get("cwd") ?? getPrimeConfig().defaultCwd
					const config = getPrimeConfig()
					const settings = config.settingsFor(cwd)
					const loader = await config.resourceLoaderFor(cwd)

					const skillsResult = loader.getSkills()
					const promptsResult = loader.getPrompts()
					const themesResult = loader.getThemes()
					const extensionsResult = loader.getExtensions()
					const agentsFilesResult = loader.getAgentsFiles()

					const diagnostics: string[] = [
						...skillsResult.diagnostics.map((d) => d.message),
						...promptsResult.diagnostics.map((d) => d.message),
						...themesResult.diagnostics.map((d) => d.message),
						...extensionsResult.errors.map((e) => `${e.path}: ${e.error}`),
					]

					return Response.json({
						packages: settings.getPackages().map(packageSourceToString),
						skills: skillsResult.skills.map((s) => ({
							name: s.name,
							description: s.description,
							path: s.filePath,
							source: s.sourceInfo?.source,
							// Every skill DefaultResourceLoader surfaces has passed through
							// settings-configured skill paths and IS available to the active
							// chat session — there is no separate "available vs installed"
							// split on prime-agent. Mark them all as workspace-visible so
							// the Pi Resources panel renders the full list.
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
					})
				}),
		},
	},
})
