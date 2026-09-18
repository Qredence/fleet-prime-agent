/**
 * Opt-in evaluation of the shipped composer-intent prompt against the live
 * TypeSafe API.
 *
 * This is NOT a test and must never run in CI: it needs a real
 * `TYPESAFE_API_KEY`, it spends tokens, and its outcome depends on the model
 * version. It exists so the routing gates can be re-derived from data instead
 * of trusted. Run it whenever the catalog, the instructions, or the thresholds
 * change:
 *
 *   pnpm exec tsx scripts/eval-composer-intent.ts
 *
 * It prints accuracy plus the precision/coverage curve per confidence gate, so
 * `COMPOSER_INTENT_FLOOR` and `COMPOSER_INTENT_EXECUTE_GATE` can be re-chosen.
 */
import { postSystemOne, TYPESAFE_RETRYABLE_STATUSES } from "../web/server/src/typesafe/client";
import { readTypeSafeConfig } from "../web/server/src/typesafe/config";
import {
	buildIntentQuestions,
	buildIntentState,
	interpretIntentResult,
} from "../web/server/src/typesafe/intent-router";

/** Pairs of [utterance, expected command id — or "none" for a genuine request]. */
const CORPUS: Array<[string, string]> = [
	// Described built-in commands, including ones that must not auto-run.
	["show me the keyboard shortcuts", "hotkeys"],
	["how much of my context window have I used?", "context"],
	["what changed in the latest release?", "changelog"],
	["rename this session to auth-refactor", "name"],
	["export this conversation as html", "export"],
	["give me a copy of this session", "clone"],
	["change the model to opus", "model"],
	["turn on fast mode", "fast"],
	["let me pick a different reasoning level", "effort"],
	["show me the exact system prompt", "system-prompt"],
	["where are the daemon logs saved?", "logs"],
	["upload my traces", "traces"],
	["start a fresh conversation", "new"],
	["this is getting long, compact it", "compact"],
	["connect the linear MCP server", "mcp"],
	["who am I authenticated as?", "login"],
	["what branches exist in this session?", "tree"],
	["set a goal for this session: ship the adapter", "goal"],
	["what does the system prompt say about tools?", "system-prompt"],
	["how much context is left before compaction?", "context"],
	["open the model picker", "model"],
	["what keyboard shortcuts exist?", "hotkeys"],
	["what sessions have I saved?", "agents"],
	// Genuine agent work worded to overlap a command description.
	["refactor the auth middleware and add tests", "none"],
	["why is the build failing on CI?", "none"],
	["summarize what we did today", "none"],
	["add a changeset for this change", "none"],
	["stop the agent", "none"],
	["show me the diff for the last commit", "none"],
	["the model selector is broken, clicking a provider does nothing", "none"],
	["add a new setting to the appearance tab", "none"],
	["write a changelog entry for this release", "none"],
	["our logs are way too noisy, cut the volume", "none"],
	["compact the tool-group component, it is doing too much", "none"],
	["export a helper from the protocol package", "none"],
	["the login flow redirects to the wrong page", "none"],
	["add tracing to the chat handler", "none"],
	["rename the field to sessionId across the protocol", "none"],
	["the session list is slow with 200 sessions", "none"],
	["we need a goal column in the sessions table", "none"],
	["support forking a message in the TUI", "none"],
	["update the biome config to allow console.log", "none"],
	["make the reload button actually reload", "none"],
	["the fast mode toggle does not persist", "none"],
];

type Scored = { text: string; expected: string; got: string; confidence: number; reason?: string };

async function classify(
	config: ReturnType<typeof readTypeSafeConfig>,
	text: string,
): Promise<{ got: string; confidence: number; reason?: string }> {
	const result = await postSystemOne(
		config,
		{ state: buildIntentState(text), questions: buildIntentQuestions() },
		{ timeoutMs: 20_000, maxRetries: 2, retryStatuses: TYPESAFE_RETRYABLE_STATUSES },
	);
	const decision = interpretIntentResult(result);
	return decision.outcome === "matched"
		? { got: decision.command.id, confidence: decision.confidence ?? 0 }
		: { got: "none", confidence: decision.confidence ?? 0, reason: decision.reason };
}

function gateTable(rows: ReadonlyArray<Scored>): void {
	console.log("\ngate  acted  wrong  precision  coverage");
	for (const gate of [0.5, 0.6, 0.7, 0.8, 0.9]) {
		const acted = rows.filter((row) => row.confidence >= gate && row.got !== "none");
		const wrong = acted.filter((row) => row.got !== row.expected).length;
		const precision = acted.length === 0 ? 1 : (acted.length - wrong) / acted.length;
		console.log(
			`${gate.toFixed(2)}  ${String(acted.length).padStart(5)}  ${String(wrong).padStart(5)}  ${precision
				.toFixed(3)
				.padStart(9)}  ${((acted.length / rows.length) * 100).toFixed(0).padStart(7)}%`,
		);
	}
}

async function main(): Promise<void> {
	const config = readTypeSafeConfig();
	if (!config.configured) {
		process.stderr.write("TYPESAFE_API_KEY is not set; nothing to evaluate.\n");
		process.exit(1);
	}

	const rows: Scored[] = [];
	for (const [text, expected] of CORPUS) {
		const { got, confidence, reason } = await classify(config, text);
		const ok = got === expected;
		rows.push({ text, expected, got, confidence, reason });
		console.log(
			`${ok ? "  " : "->"} ${text.slice(0, 58).padEnd(58)} ${expected.padEnd(14)} ${got.padEnd(14)} ${confidence.toFixed(
				2,
			)}${reason ? `  (${reason})` : ""}`,
		);
	}

	const correct = rows.filter((row) => row.got === row.expected).length;
	const falsePositives = rows.filter((row) => row.expected === "none" && row.got !== "none").length;
	console.log(`\ncorrect ${correct}/${rows.length}   hijacked real requests ${falsePositives}`);
	console.log(`reason histogram: ${JSON.stringify(countBy(rows.map((r) => r.reason ?? "matched")))}`);
	gateTable(rows);
}

function countBy(values: ReadonlyArray<string>): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	return counts;
}

await main();
