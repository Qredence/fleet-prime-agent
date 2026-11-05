/**
 * Which thinking levels a model supports.
 *
 * Ported from the SDK's `getSupportedThinkingLevels` so Fleet can answer this
 * from a model record it already has, instead of importing `@earendil-works/pi-ai`
 * at runtime. The rule is unchanged: a non-reasoning model offers only `off`,
 * and `xhigh` / `max` are offered only when the model maps them explicitly,
 * because most providers ignore those levels rather than downgrading them.
 */
import type { ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol";

/** Ordered from least to most effort, matching the runtime's own list. */
export const THINKING_LEVELS: readonly ChatThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/** The subset of a model record this needs. */
export type ThinkingLevelModel = {
	readonly reasoning: boolean;
	/** `null` marks a level the provider rejects; absent marks one it ignores. */
	readonly thinkingLevelMap?: Record<string, string | null> | undefined;
};

const EXPLICIT_ONLY_LEVELS = new Set<ChatThinkingLevel>(["xhigh", "max"]);

export function supportedThinkingLevels(model: ThinkingLevelModel): ChatThinkingLevel[] {
	if (!model.reasoning) return ["off"];
	const map = model.thinkingLevelMap;
	return THINKING_LEVELS.filter((level) => {
		const mapped = map?.[level];
		if (mapped === null) return false;
		if (EXPLICIT_ONLY_LEVELS.has(level)) return mapped !== undefined;
		return true;
	});
}
