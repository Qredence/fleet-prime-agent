/**
 * Builds the System One question that recognises a described built-in command,
 * and interprets its answer.
 *
 * The catalog and the decision rule live in `@prime-agent/web-protocol` so the
 * server and the browser cannot drift. This module only turns them into a
 * question and reads the typed answer back.
 */
import {
	COMPOSER_INTENT_COMMANDS,
	COMPOSER_INTENT_NONE,
	type ComposerIntentDecision,
	composerIntentCommand,
	decideComposerIntent,
	isSingleTokenDraft,
} from "@prime-agent/web-protocol/composer-intent";
import {
	type ChoiceQuestion,
	choice,
	choiceAnswer,
	type NoulQuestion,
	noul,
	noulAnswer,
	type SystemOneQuestion,
	type SystemOneResult,
	type TypeSafeEntry,
} from "./client";

/** Ids of the two questions asked in every routing request. */
export const INTENT_ROUTE_QUESTION_ID = "route";
export const INTENT_CODE_TASK_QUESTION_ID = "is_code_task";

/** Draft characters forwarded as state. Nothing longer informs the judgment. */
export const MAX_INTENT_STATE_CHARS = 1_000;

const ROUTE_INSTRUCTIONS = [
	"`utterance` is free text a developer typed into the message composer of a coding-agent chat app.",
	"`commands` lists the app's built-in commands, each with an `id`, a `what` description, and optional `args`.",
	"",
	"Decide whether the developer is asking the app to RUN one of those commands, or whether the text is an ordinary request for the coding agent.",
	"",
	"Rules:",
	"- Every command in `commands` only changes the app's own interface or the conversation session. None of them read, write, edit, run, or inspect code, files, tests, dependencies, or git.",
	"- If `utterance` asks for any work on code, files, tests, builds, dependencies, git, or the workspace, answer `none` — even when it also contains a word that appears in a command description.",
	"- Answer `none` when no command clearly matches what the developer wants, and when you are unsure.",
	"- Match the developer's intent, not a word the text happens to share with a description.",
].join("\n");

const CODE_TASK_INSTRUCTIONS = [
	"Does `utterance` ask for real engineering work on code, files, tests, builds, dependencies, git, or the workspace?",
	"Bug reports, feature requests, questions about the codebase, and refactors all count as yes.",
	"Requests about the app's own interface, the session, or the conversation do not count, even when they mention code:",
	"setting a goal, compacting the session, renaming a session, or changing how much reasoning the model uses are all no.",
].join("\n");

const CODE_TASK_CRITERIA = {
	true: "The developer wants engineering work done on code, files, tests, builds, dependencies, git, or the workspace.",
	false: "The developer wants the app's own interface or session acted on, or is making conversation.",
};

/** The `state` sent with every routing request. Fixed and code-owned. */
export type IntentState = {
	utterance: string;
	commands: Array<{ id: string; what: string; args?: string }>;
};

/**
 * Builds the request state.
 *
 * The command list comes from the code-owned catalog, never from the request
 * body: accepting browser-supplied command descriptions would be a
 * prompt-injection hole.
 */
export function buildIntentState(text: string): IntentState {
	return {
		utterance: text.slice(0, MAX_INTENT_STATE_CHARS),
		commands: COMPOSER_INTENT_COMMANDS.map((command) => ({
			id: command.id,
			what: command.description,
			...(command.argumentHint ? { args: command.argumentHint } : {}),
		})),
	};
}

/**
 * Builds both questions for one routing request.
 *
 * `is_code_task` is asked alongside the route question rather than after it:
 * the model evaluates every question in a request in parallel, so the guard
 * costs no extra latency.
 */
export function buildIntentQuestions(): Record<string, SystemOneQuestion> {
	const criteria: Record<string, TypeSafeEntry> = {
		[COMPOSER_INTENT_NONE]: "The text should be sent to the coding agent as an ordinary message.",
	};
	for (const command of COMPOSER_INTENT_COMMANDS) {
		criteria[command.id] = command.argumentHint
			? `${command.description}. Arguments the developer may name: ${command.argumentHint}.`
			: command.description;
	}
	const route: ChoiceQuestion = choice(ROUTE_INSTRUCTIONS, criteria);
	const codeTask: NoulQuestion = noul(CODE_TASK_INSTRUCTIONS, CODE_TASK_CRITERIA);
	return { [INTENT_ROUTE_QUESTION_ID]: route, [INTENT_CODE_TASK_QUESTION_ID]: codeTask };
}

/**
 * Reads a routing answer. A missing or mistyped answer is treated as "no match"
 * rather than an error, so an unexpected response degrades to normal chat.
 *
 * `draft` is needed because a single-token draft is offered but never run
 * automatically — see {@link isSingleTokenDraft}.
 */
export function interpretIntentResult(
	result: SystemOneResult,
	draft: string,
): ComposerIntentDecision & {
	confidence?: number;
	codeTaskProbability?: number;
} {
	const route = choiceAnswer(result, INTENT_ROUTE_QUESTION_ID);
	const codeTask = noulAnswer(result, INTENT_CODE_TASK_QUESTION_ID);
	if (!route) return { outcome: "none", reason: "no_match" };

	const confidence = typeof route.confidence === "number" ? route.confidence : 0;
	const codeTaskProbability = codeTask && typeof codeTask.noul === "number" ? codeTask.noul : 0;
	const decision = decideComposerIntent({
		command: route.choice,
		confidence,
		codeTaskProbability,
		// Only the first MAX_INTENT_STATE_CHARS reached the model, so anything
		// longer was judged on a prefix: a draft that opens with a context request
		// and ends with real work must not be executed on the strength of its
		// opening.
		requireConfirmation: isSingleTokenDraft(draft) || draft.trim().length > MAX_INTENT_STATE_CHARS,
	});
	if (decision.outcome === "none") return decision;

	// Guard against an answer that names a command the catalog no longer holds.
	if (!composerIntentCommand(decision.command.id)) return { outcome: "none", reason: "no_match" };

	return { ...decision, confidence, codeTaskProbability };
}
