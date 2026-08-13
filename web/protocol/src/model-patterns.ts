import type { ChatThinkingLevel } from "./chat-protocol";

const THINKING_LEVELS = new Set<ChatThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

// Compiled glob patterns are reused across model-list iterations; caching the
// RegExp avoids recompiling on every candidate check. Bounded to a small cap.
const globRegexCache = new Map<string, RegExp>();
const GLOB_REGEX_CACHE_LIMIT = 500;

function getGlobRegex(normalizedPattern: string) {
	const cached = globRegexCache.get(normalizedPattern);
	if (cached) return cached;
	const regex = new RegExp(
		`^${normalizedPattern
			.split("")
			.map((character) => (character === "*" ? ".*" : character === "?" ? "." : escapeRegExp(character)))
			.join("")}$`,
	);
	if (globRegexCache.size >= GLOB_REGEX_CACHE_LIMIT) {
		globRegexCache.clear();
	}
	globRegexCache.set(normalizedPattern, regex);
	return regex;
}

/** A model that can be tested against an enabled-model pattern. */
export type ModelPatternCandidate = {
	id: string;
	name?: string;
	key?: string;
	provider?: string;
	modelId?: string;
};

/**
 * Whether a model is enabled by a set of patterns.
 *
 * @param model - the model to test
 * @param patterns - `undefined` allows all models, `[]` denies all, otherwise
 *   the model must match at least one pattern (see {@link modelMatchesPattern})
 * @returns `true` when the model should be offered/enabled
 */
export function isModelPatternEnabled(model: ModelPatternCandidate, patterns: Array<string> | undefined) {
	if (patterns === undefined) return true;
	if (patterns.length === 0) return false;
	return patterns.some((pattern) => modelMatchesPattern(model, pattern));
}

/**
 * Whether a single pattern matches a model.
 *
 * Matching is case-insensitive, ignores a trailing thinking-level suffix (see
 * {@link stripThinkingLevel}), and compares against the model's `id`,
 * `modelId`, `name`, `key`, and `provider/modelId` / `provider/id` forms.
 * Patterns containing `*` or `?` are treated as globs (`*` = any run,
 * `?` = one char); all other patterns must match a candidate exactly.
 *
 * @param model - the model to test
 * @param pattern - a glob or exact pattern, optionally suffixed with `:<level>`
 * @returns `true` when any candidate form matches the pattern
 */
export function modelMatchesPattern(model: ModelPatternCandidate, pattern: string) {
	const normalizedPattern = stripThinkingLevel(pattern.trim()).toLowerCase();
	const candidates = [
		model.id,
		model.modelId,
		model.name,
		model.key,
		model.provider && model.modelId ? `${model.provider}/${model.modelId}` : undefined,
		model.provider && model.id ? `${model.provider}/${model.id}` : undefined,
	]
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.toLowerCase());

	if (!hasGlobCharacters(normalizedPattern)) {
		return candidates.includes(normalizedPattern);
	}

	const matcher = getGlobRegex(normalizedPattern);
	return candidates.some((candidate) => matcher.test(candidate));
}

/**
 * Remove a trailing thinking-level suffix (e.g. `:high`) from a pattern.
 * A suffix is only stripped when it matches a known thinking level, so a
 * pattern like `openai:gpt-4o` (non-level suffix) is left intact.
 *
 * @param pattern - the pattern possibly ending in `:<thinkingLevel>`
 * @returns the pattern without its thinking-level suffix
 */
export function stripThinkingLevel(pattern: string) {
	const separatorIndex = pattern.lastIndexOf(":");
	if (separatorIndex === -1) return pattern;
	const suffix = pattern.slice(separatorIndex + 1);
	return THINKING_LEVELS.has(suffix as ChatThinkingLevel) ? pattern.slice(0, separatorIndex) : pattern;
}

/** Whether a pattern uses glob wildcards (`*` or `?`). */
export function hasGlobCharacters(pattern: string) {
	return pattern.includes("*") || pattern.includes("?");
}

/** Escape a string so it can be embedded literally in a RegExp. */
export function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the canonical `provider/modelId` pattern form for a model.
 *
 * @param provider - the provider id (e.g. `openai`)
 * @param modelId - the model id (e.g. `gpt-4o`)
 * @returns a pattern string usable with {@link modelMatchesPattern}
 */
export function modelPattern(provider: string, modelId: string) {
	return `${provider}/${modelId}`;
}
