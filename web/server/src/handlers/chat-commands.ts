import { getPrimeConfig } from "../prime-config";
import { wrapApiHandler } from "../wrap-api-handler";

const BUILTIN_SLASH_COMMANDS: ReadonlyArray<{
	name: string;
	description: string;
	argumentHint?: string;
}> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)", argumentHint: "[search]" },
	{ name: "effort", description: "Select reasoning/thinking level (opens selector UI)", argumentHint: "[level]" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "session", description: "Show session info" },
	{
		name: "new",
		description: "Start a new session, optionally named and/or with an initial prompt",
		argumentHint: '[--name "session name" --] [prompt]',
	},
	{
		name: "compact",
		description: "Compact the session context; optional instructions focus the summary",
		argumentHint: "[instructions]",
	},
	{ name: "refine", description: "Refine continual harness prompt notes, skills, subagents, and memory" },
	{
		name: "goal",
		description: "Set or view a persistent goal; supports pause, resume, and clear",
		argumentHint: "[objective]",
	},
	{ name: "autonomous", description: "Set or view autonomous mode", argumentHint: "[status|on|off]" },
];

export function handleChatCommandsGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const url = new URL(request.url);
		const cwd = url.searchParams.get("cwd") ?? getPrimeConfig().defaultCwd;
		const config = getPrimeConfig();
		const loader = await config.resourceLoaderFor(cwd);

		const skillsResult = loader.getSkills();
		const promptsResult = loader.getPrompts();
		const extensionsResult = loader.getExtensions();
		const enableSkillCommands = config.settingsFor(cwd).getEnableSkillCommands();

		const builtin = BUILTIN_SLASH_COMMANDS.map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
			argumentHint: cmd.argumentHint,
			source: "builtin" as const,
		}));

		const skillCommands = enableSkillCommands
			? skillsResult.skills.map((skill) => ({
					name: `skill:${skill.name}`,
					description: skill.description,
					source: "skill" as const,
					passThrough: true,
				}))
			: [];

		const promptCommands = promptsResult.prompts.map((p) => ({
			name: p.name,
			description: p.description,
			argumentHint: p.argumentHint,
			source: "prompt" as const,
			passThrough: true,
		}));

		const extensionCommands = extensionsResult.extensions.flatMap((ext) =>
			Array.from(ext.commands.values()).map((cmd) => ({
				name: cmd.name,
				description: cmd.description,
				source: "extension" as const,
			})),
		);

		const diagnostics: string[] = [
			...skillsResult.diagnostics.map((d) => d.message),
			...promptsResult.diagnostics.map((d) => d.message),
			...extensionsResult.errors.map((e) => `${e.path}: ${e.error}`),
		];

		return Response.json({
			commands: [...builtin, ...skillCommands, ...promptCommands, ...extensionCommands],
			diagnostics,
		});
	});
}
