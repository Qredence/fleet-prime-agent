/**
 * Composer intent routing vocabulary.
 *
 * The chat composer only reaches a local UI action when the user types the
 * exact slash command. This module owns the shared vocabulary for an optional
 * layer that recognises when free text is *describing* a built-in command.
 *
 * It lives in `web/protocol` because both sides need it and they must not
 * drift: the server builds its System One question from
 * {@link COMPOSER_INTENT_COMMANDS}, and the browser maps the answer back onto
 * the existing `LocalSlashAction` union.
 */

/** Where a routed command runs once the user accepts it. */
export type ComposerIntentHandling =
	/** Applied in the browser through the existing `resolveLocalSlashAction`. */
	| "local"
	/** Sent through the chat transport as `/<id>`, exactly as if typed. */
	| "session";

/**
 * One command a free-text utterance may plausibly be describing.
 *
 * Deliberately a subset of the built-in command list: commands a user would
 * not describe in prose are absent, and an absent id simply is never routed.
 */
export type ComposerIntentCommandInfo = {
	id: string;
	description: string;
	argumentHint?: string;
	handling: ComposerIntentHandling;
	/**
	 * Whether this command may run the moment the composer is submitted.
	 * True only for commands that are read-only or idempotent and change
	 * nothing the user would have to undo.
	 */
	autoExecutable: boolean;
};

/**
 * The routable command catalog.
 *
 * Invariants, both asserted by tests:
 * - every `handling: "local"` id resolves to a non-null `LocalSlashAction`;
 * - every `handling: "session"` id has `autoExecutable: false`.
 */
export const COMPOSER_INTENT_COMMANDS: ReadonlyArray<ComposerIntentCommandInfo> = [
	{
		id: "context",
		description: "Show how much of the model's context window the session has used",
		handling: "local",
		autoExecutable: true,
	},
	{
		id: "session",
		description: "Show the current session's identifier and display name",
		handling: "local",
		autoExecutable: true,
	},
	{ id: "copy", description: "Copy the agent's last reply to the clipboard", handling: "local", autoExecutable: true },
	{
		id: "share",
		description: "Copy the whole conversation transcript to the clipboard",
		handling: "local",
		autoExecutable: true,
	},
	{ id: "hotkeys", description: "Show the keyboard shortcuts", handling: "local", autoExecutable: true },
	{
		id: "changelog",
		description: "Show what changed in recent Fleet Prime releases",
		handling: "local",
		autoExecutable: true,
	},
	{
		id: "system-prompt",
		description: "Show the exact system prompt sent to the model",
		handling: "local",
		autoExecutable: true,
	},
	{
		id: "logs",
		description: "Show where the runtime's log files are stored",
		handling: "local",
		autoExecutable: true,
	},
	{ id: "agents", description: "List the saved sessions", handling: "local", autoExecutable: true },
	{
		id: "traces",
		description: "Preview, upload, or configure Fleet Prime traces",
		argumentHint: "[status|on|off|preview|upload]",
		handling: "local",
		autoExecutable: false,
	},
	{
		id: "model",
		description: "Switch which AI model answers, or open the model picker",
		argumentHint: "[provider/id]",
		handling: "local",
		autoExecutable: false,
	},
	{
		id: "effort",
		description: "Set how much reasoning effort the model spends, or open the effort picker",
		argumentHint: "[level]",
		handling: "local",
		autoExecutable: false,
	},
	{ id: "fast", description: "Toggle fast mode", handling: "local", autoExecutable: false },
	{ id: "settings", description: "Open the app's Settings", handling: "local", autoExecutable: false },
	{ id: "mcp", description: "Open the MCP server connections in Settings", handling: "local", autoExecutable: false },
	{
		id: "export",
		description: "Export the session to a file",
		argumentHint: "[path]",
		handling: "local",
		autoExecutable: false,
	},
	{
		id: "name",
		description: "Rename the current session",
		argumentHint: "[name]",
		handling: "local",
		autoExecutable: false,
	},
	{
		id: "tree",
		description: "Show the session's branch tree so another branch can be selected",
		handling: "local",
		autoExecutable: false,
	},
	{
		id: "fork",
		description: "Create a new session forked from an earlier user message",
		argumentHint: "[message-entry-id]",
		handling: "local",
		autoExecutable: false,
	},
	{
		id: "clone",
		description: "Duplicate the current session at its current position",
		handling: "local",
		autoExecutable: false,
	},
	{ id: "login", description: "Open provider sign-in", handling: "local", autoExecutable: false },
	{ id: "logout", description: "Open provider sign-out", handling: "local", autoExecutable: false },
	{
		id: "reload",
		description: "Reload keybindings, extensions, skills, prompts, and themes",
		handling: "local",
		autoExecutable: false,
	},
	{ id: "new", description: "Start a new chat session", handling: "local", autoExecutable: false },
	{
		id: "compact",
		description: "Compact the session context to free room in the model's context window",
		argumentHint: "[instructions]",
		handling: "session",
		autoExecutable: false,
	},
	{
		id: "goal",
		description: "Set or view a persistent goal for the session",
		argumentHint: "[objective]",
		handling: "session",
		autoExecutable: false,
	},
];

/** Every routable command id, for question construction and result validation. */
export const COMPOSER_INTENT_COMMAND_IDS: ReadonlyArray<string> = COMPOSER_INTENT_COMMANDS.map((c) => c.id);

const COMPOSER_INTENT_COMMAND_BY_ID: ReadonlyMap<string, ComposerIntentCommandInfo> = new Map(
	COMPOSER_INTENT_COMMANDS.map((command) => [command.id, command]),
);

/** Looks up a routable command, or `undefined` when the id is not in the catalog. */
export function composerIntentCommand(id: string | undefined): ComposerIntentCommandInfo | undefined {
	return id === undefined ? undefined : COMPOSER_INTENT_COMMAND_BY_ID.get(id);
}

/** The value the model returns when nothing in the catalog matches. */
export const COMPOSER_INTENT_NONE = "none";

/**
 * Below this the model is genuinely unsure: send the text as a normal message.
 *
 * Measured over the corpus in `scripts/eval-composer-intent.ts` (44 labelled
 * utterances, roughly half being real engineering requests): a single false
 * positive out of 22 actions, and it sits at 0.78 — inside the suggest band, so
 * it is offered rather than run.
 */
export const COMPOSER_INTENT_FLOOR = 0.6;

/**
 * At or above this, a {@link ComposerIntentCommandInfo.autoExecutable} command
 * may run.
 *
 * Measured on the same corpus: 18 actions, **zero** wrong, 41% of drafts. At
 * 0.7 the single remaining error is admitted, which is why this sits at 0.8.
 * Re-derive both constants with the eval script rather than trusting them.
 */
export const COMPOSER_INTENT_EXECUTE_GATE = 0.8;

/**
 * Above this probability the utterance is treated as real engineering work and
 * routing is refused outright. A second, independent signal from the Choice
 * distribution: it defends the costly error (hijacking a genuine request) even
 * when the model is confidently wrong about which command matched.
 */
export const COMPOSER_INTENT_CODE_TASK_MAX = 0.3;

/** Why a routing attempt produced no action. Never surfaces raw model output. */
export type ComposerIntentReason =
	| "disabled"
	| "not_ready"
	| "empty"
	| "no_match"
	| "code_task"
	| "below_floor"
	| "unavailable"
	| "rate_limited";

/** How an accepted match is surfaced. */
export type ComposerIntentDisposition =
	/** Safe to run the instant the composer is submitted. */
	| "execute"
	/** Offer it; the user accepts explicitly. */
	| "suggest";

export type ComposerIntentDecision =
	| { outcome: "none"; reason: ComposerIntentReason }
	| {
			outcome: "matched";
			command: ComposerIntentCommandInfo;
			disposition: ComposerIntentDisposition;
	  };

/**
 * Turns a model answer into a routing decision. Pure, so every band boundary is
 * a table test rather than something only observable against the live API.
 *
 * Order matters: the code-task guard runs before the confidence bands, so a
 * confident-but-wrong match on a real request still falls through.
 */
export function decideComposerIntent(input: {
	command: string | undefined;
	confidence: number;
	codeTaskProbability: number;
}): ComposerIntentDecision {
	if (input.codeTaskProbability >= COMPOSER_INTENT_CODE_TASK_MAX) {
		return { outcome: "none", reason: "code_task" };
	}
	if (!input.command || input.command === COMPOSER_INTENT_NONE) {
		return { outcome: "none", reason: "no_match" };
	}
	const command = composerIntentCommand(input.command);
	if (!command) return { outcome: "none", reason: "no_match" };
	if (input.confidence < COMPOSER_INTENT_FLOOR) {
		return { outcome: "none", reason: "below_floor" };
	}
	if (input.confidence >= COMPOSER_INTENT_EXECUTE_GATE && command.autoExecutable) {
		return { outcome: "matched", command, disposition: "execute" };
	}
	return { outcome: "matched", command, disposition: "suggest" };
}

/** Coarse readiness of the optional classifier, as shown in Settings. */
export type ComposerIntentStatus = "unconfigured" | "unverified" | "ready" | "error";

/** Request body for `POST /api/chat/intent`. */
export type ComposerIntentRequest = {
	/** The composer draft. Truncated server-side before it leaves the process. */
	text: string;
	projectId?: string;
};

/**
 * Response for `POST /api/chat/intent`.
 *
 * Carries a decision, never model prose: no instructions, no probabilities, and
 * no error text. `enabled` tells the browser whether to keep asking; it never
 * explains why the classifier is unavailable.
 */
export type ComposerIntentResponse = {
	enabled: boolean;
	outcome: "none" | "matched";
	command?: string;
	confidence?: number;
	disposition?: ComposerIntentDisposition;
	reason?: ComposerIntentReason;
	/** Model id that answered, for diagnostics. */
	model?: string;
	latencyMs?: number;
};
