import type { PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";

export const BACKEND_SESSION_COMMAND_NAMES = ["compact", "refine", "goal", "autonomous"] as const;

export type BackendSessionCommandName = (typeof BACKEND_SESSION_COMMAND_NAMES)[number];

export type BackendSessionCommand = {
	name: BackendSessionCommandName;
	args: string;
	text: string;
};

const BACKEND_SESSION_COMMAND_NAME_SET: ReadonlySet<string> = new Set(BACKEND_SESSION_COMMAND_NAMES);

/** Parse the session commands that the upstream AgentSession executes itself. */
export function parseBackendSessionCommand(text: string): BackendSessionCommand | undefined {
	if (/[\r\n\u2028\u2029]/u.test(text)) return undefined;
	const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
	if (!match) return undefined;
	const [, rawName, rawArgs = ""] = match;
	if (!rawName || !BACKEND_SESSION_COMMAND_NAME_SET.has(rawName)) return undefined;
	return { name: rawName as BackendSessionCommandName, args: rawArgs.trim(), text };
}

function editCountText(count: number): string {
	return `${count} edit${count === 1 ? "" : "s"} applied`;
}

/** Describe the terminal result of a session command for the web transcript. */
export function sessionCommandResultText(
	command: BackendSessionCommand,
	presentation: PrimeAgentSessionPresentation,
	initialRefinementCount: number,
): string {
	if (command.name === "refine") {
		const refinement = presentation.refinements.slice(initialRefinementCount).at(-1);
		if (!refinement) return "/refine completed.";
		if (refinement.status === "error") return `/refine failed: ${refinement.error ?? "Unknown refinement error"}`;
		return `Refined continual harness state: ${editCountText(refinement.edits.filter((edit) => edit.applied).length)}.`;
	}

	if (command.name === "goal") {
		return presentation.goal?.objective
			? `Goal ${presentation.goal.status}: ${presentation.goal.objective}`
			: "No active goal.";
	}

	return `/${command.name} completed.`;
}
