/**
 * Offline evaluation of the adaptive composer completion.
 *
 * Model-free, network-free and free to run, so unlike
 * `eval-composer-intent.ts` this one belongs in CI. It replays the persisted
 * prompt index through the shipped `findCompletion` — the real function, at
 * overridden thresholds, never a copy — and answers the two questions the
 * design rests on:
 *
 *   1. Does preferring the current session's own history actually help?
 *   2. Are *long* ghosts (confidence ≥ the extend threshold) materially more
 *      accurate than short ones? If they are not, the length rule is
 *      decoration and should be replaced by "always paint the agreed part".
 *
 * Leave-one-out is the whole methodology: the instance being predicted is
 * removed from the pool, so a target can never complete itself. A first pass
 * that omitted this measured 100 % completable, which was the bug, not a result.
 *
 *   pnpm exec tsx scripts/eval-composer-completion.ts
 *   pnpm exec tsx scripts/eval-composer-completion.ts --agent-dir ~/.prime/agent --sample 4000
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
	COMPOSER_COMPLETION_EXTEND_CONFIDENCE,
	COMPOSER_COMPLETION_MAX_CHARS,
	COMPOSER_COMPLETION_MIN_CHARS,
	normalizeCompletionDraft,
} from "../web/protocol/src/composer-completion.js";
import { type CompletionCandidate, findCompletion } from "../web/server/src/completion/match.js";
import {
	flattenPromptIndex,
	PROMPT_INDEX_CANDIDATE_LIMIT,
	readPromptIndexFile,
} from "../web/server/src/completion/prompt-index.js";

/** Draft lengths to probe. The floor is where a request starts being made at all. */
const PREFIX_LENGTHS = [4, 8, 12, 16, 20];

/**
 * Probabilities of a suggestion being right.
 *
 * `exact` — accepting yields exactly the prompt the user went on to write.
 * `prefix` — a strict prefix of it: Tab moves them along without inventing text.
 * `other` — neither. Not always wrong (it may be a different prompt they also
 *   wrote), but it is not evidence for this one.
 */
type Outcome = "none" | "exact" | "prefix" | "other";

type Case = {
	draft: string;
	target: string;
	/** Session the target came from; its id selects the tier at match time. */
	sessionFile: string;
	/** Removes exactly the target instance from the pool. */
	exclude: (candidate: CompletionCandidate) => boolean;
};

type Rule = "shipped" | "agree-only" | "always-extend";

function ruleOptions(rule: Rule, sessionId: string): Parameters<typeof findCompletion>[2] {
	if (rule === "agree-only") return { sessionId, extendConfidence: 2 };
	if (rule === "always-extend") return { sessionId, extendConfidence: 0 };
	return { sessionId };
}

function classify(completion: string | undefined, target: string): Outcome {
	if (completion === undefined) return "none";
	const value = normalizeCompletionDraft(completion);
	if (value === target) return "exact";
	return target.startsWith(value) ? "prefix" : "other";
}

function parseArgs(argv: ReadonlyArray<string>): { agentDir: string; sample: number } {
	let agentDir = join(homedir(), ".prime", "agent");
	let sample = 4_000;
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--agent-dir" && argv[index + 1]) agentDir = argv[index + 1] as string;
		if (argv[index] === "--sample" && argv[index + 1]) sample = Number(argv[index + 1]);
	}
	return { agentDir, sample };
}

/** Deterministic thinning, so two runs on the same corpus compare like for like. */
function thin<T>(rows: ReadonlyArray<T>, limit: number): Array<T> {
	if (rows.length <= limit) return [...rows];
	const stride = rows.length / limit;
	return Array.from({ length: limit }, (_, index) => rows[Math.floor(index * stride)] as T);
}

/**
 * `safe` is the headline: accepting the ghost yields a prompt the user actually
 * went on to write, or a prefix of one. `other` is the cost — Tab inserts text
 * that is evidence for nothing here, though it may still be a prompt they wrote
 * in another session, which is why it is reported rather than called wrong.
 */
function rates(outcomes: ReadonlyArray<Outcome>): string {
	const offered = outcomes.filter((outcome) => outcome !== "none").length;
	const share = (count: number) => (offered === 0 ? "  —  " : `${((count / offered) * 100).toFixed(1)}%`.padStart(6));
	const count = (outcome: Outcome) => outcomes.filter((o) => o === outcome).length;
	const safe = count("exact") + count("prefix");
	return `${String(offered).padStart(6)}  ${share(safe)}  ${share(count("exact"))}  ${share(count("prefix"))}  ${share(
		count("other"),
	)}`;
}

async function main(): Promise<void> {
	const { agentDir, sample } = parseArgs(process.argv.slice(2));
	const index = await readPromptIndexFile(agentDir);
	if (!index || index.sessions.length === 0) {
		process.stderr.write(
			`No prompt index at ${agentDir}. Open the app once so it builds one, or pass --agent-dir <path>.\n`,
		);
		process.exit(1);
	}

	// Uncapped, so the leave-one-out removal happens before the recency cut rather
	// than after it: removing an instance from an already-truncated list would leave
	// the target able to complete itself whenever it sat just inside the cut.
	const all = flattenPromptIndex(index, Number.MAX_SAFE_INTEGER);
	const totalPrompts = index.sessions.reduce((sum, session) => sum + session.prompts.length, 0);
	process.stdout.write(
		`corpus: ${index.sessions.length} sessions, ${totalPrompts} prompts, ${all.length} candidates ` +
			`(production cap ${PROMPT_INDEX_CANDIDATE_LIMIT})\n`,
	);

	const cases: Array<Case> = [];
	for (const session of index.sessions) {
		const base = Date.parse(session.modified);
		const sessionAt = Number.isFinite(base) ? base : 0;
		session.prompts.forEach((prompt, offset) => {
			const target = normalizeCompletionDraft(prompt);
			const at = sessionAt + Math.min(offset, 999) / 1000;
			const instance = { text: target, at, sessionFile: session.sessionFile };
			for (const length of PREFIX_LENGTHS) {
				if (target.length <= length) continue;
				cases.push({
					draft: target.slice(0, length),
					target,
					sessionFile: session.sessionFile,
					exclude: (candidate) =>
						!(
							candidate.sessionFile === instance.sessionFile &&
							candidate.text === instance.text &&
							candidate.at === instance.at
						),
				});
			}
		});
	}
	const sampled = thin(cases, sample);
	process.stdout.write(
		`cases:  ${cases.length} total, ${sampled.length} evaluated ` +
			"(differences under a few points on a few hundred cases are noise)\n",
	);

	const byLength = new Map<number, Array<Outcome>>();
	const bySource = new Map<string, Array<Outcome>>();
	const byRule = new Map<Rule, Array<Outcome>>();
	const byTier = new Map<string, Array<Outcome>>();
	/**
	 * Paired, not two independent rate rows: the same case run with and without the
	 * session tier. Two rates over the same population would hide that the two runs
	 * offer on *different* cases, which is the entire question — the tier's value is
	 * mostly coverage, not accuracy.
	 */
	const sessionFirst = {
		onlyWith: 0,
		onlyWithout: 0,
		bothWith: [] as Array<Outcome>,
		bothWithout: [] as Array<Outcome>,
	};

	for (const testCase of sampled) {
		const pool = all.filter(testCase.exclude).slice(0, PROMPT_INDEX_CANDIDATE_LIMIT);
		const sessionId =
			testCase.sessionFile
				.split("/")
				.pop()
				?.replace(/\.jsonl$/, "") ?? "";
		const suggested = findCompletion(testCase.draft, pool, ruleOptions("shipped", sessionId));
		const outcome = classify(suggested?.completion, testCase.target);

		const length = testCase.draft.length;
		(byLength.get(length) ?? byLength.set(length, []).get(length)!).push(outcome);

		// Tier accounting uses the same run, so "session" below means the tier really
		// was the session's own history and not merely that a session was named.
		if (suggested) {
			const tier = suggested.source === "session" ? "session tier" : "corpus tier";
			(bySource.get(tier) ?? bySource.set(tier, []).get(tier)!).push(outcome);
		}

		// The adaptive rule's own value: is a long ghost better than a short one?
		// Split *within* the tier, never across it. Only the session tier can reach
		// the extend threshold; the corpus tier always paints the agreed prefix, so
		// a flat long/short split would mix two different length policies.
		if (suggested) {
			const tier = suggested.source === "session" ? "session" : "corpus";
			const band = suggested.confidence >= COMPOSER_COMPLETION_EXTEND_CONFIDENCE ? "long (≥0.8)" : "short (0.5–0.8)";
			const key = `${tier} / ${band}`;
			(byTier.get(key) ?? byTier.set(key, []).get(key)!).push(outcome);
		}

		for (const rule of ["shipped", "agree-only", "always-extend"] as const) {
			const comparison =
				rule === "shipped" ? suggested : findCompletion(testCase.draft, pool, ruleOptions(rule, sessionId));
			(byRule.get(rule) ?? byRule.set(rule, []).get(rule)!).push(classify(comparison?.completion, testCase.target));
		}

		// Question 1: the same case, once with the session's own history available and
		// once without. The difference is the tiering, and nothing else.
		const hasOwnHistory = pool.some(
			(candidate) =>
				candidate.sessionFile === testCase.sessionFile &&
				candidate.text.startsWith(normalizeCompletionDraft(testCase.draft)),
		);
		if (hasOwnHistory) {
			const without = classify(findCompletion(testCase.draft, pool)?.completion, testCase.target);
			if (outcome !== "none" && without === "none") sessionFirst.onlyWith += 1;
			else if (outcome === "none" && without !== "none") sessionFirst.onlyWithout += 1;
			else if (outcome !== "none" && without !== "none") {
				sessionFirst.bothWith.push(outcome);
				sessionFirst.bothWithout.push(without);
			}
		}
	}

	const header = "\n            cases    safe   exact  prefix   other";
	process.stdout.write(`\nby draft length (characters)${header}\n`);
	for (const length of PREFIX_LENGTHS) {
		const outcomes = byLength.get(length);
		if (outcomes) process.stdout.write(`${String(length).padStart(12)}  ${rates(outcomes)}\n`);
	}

	process.stdout.write(`\nby tier${header}\n`);
	for (const [tier, outcomes] of bySource) process.stdout.write(`${tier.padStart(12)}  ${rates(outcomes)}\n`);

	process.stdout.write(`\nby ghost length inside each tier — the adaptive rule's premise${header}\n`);
	for (const [key, outcomes] of byTier) process.stdout.write(`${key.padStart(24)}  ${rates(outcomes)}\n`);

	process.stdout.write(`\nby rule${header}\n`);
	for (const [rule, outcomes] of byRule) process.stdout.write(`${rule.padStart(12)}  ${rates(outcomes)}\n`);

	process.stdout.write(`\nsession-first value${header}\n`);
	process.stdout.write(
		`  offered only because of the session tier: ${sessionFirst.onlyWith}\n` +
			`  offered only without it:                  ${sessionFirst.onlyWithout}\n`,
	);
	process.stdout.write(`${"with session".padStart(12)}  ${rates(sessionFirst.bothWith)}\n`);
	process.stdout.write(`${"without".padStart(12)}  ${rates(sessionFirst.bothWithout)}\n`);
	process.stdout.write("  (the last two rows are over the cases both runs offered on)\n");

	const offered = Array.from(byLength.values()).flat();
	const wrong = offered.filter((outcome) => outcome === "other").length;
	process.stdout.write(
		`\nthresholds in force: minChars ${COMPOSER_COMPLETION_MIN_CHARS}, maxChars ${COMPOSER_COMPLETION_MAX_CHARS}\n` +
			`offered ${offered.filter((o) => o !== "none").length}/${offered.length} cases; of those ` +
			`${((wrong / Math.max(1, offered.filter((o) => o !== "none").length)) * 100).toFixed(1)}% matched neither the target nor a prefix of it\n`,
	);
}

await main();
