import { describe, expect, it } from "vitest";
import { supportedThinkingLevels, THINKING_LEVELS } from "../thinking-levels";

describe("supportedThinkingLevels", () => {
	it("offers only off for a model without reasoning", () => {
		expect(supportedThinkingLevels({ reasoning: false })).toEqual(["off"]);
		// A thinking map must not resurrect levels for a non-reasoning model.
		expect(supportedThinkingLevels({ reasoning: false, thinkingLevelMap: { high: "high" } })).toEqual(["off"]);
	});

	it("offers the standard levels for a reasoning model with no map", () => {
		expect(supportedThinkingLevels({ reasoning: true })).toEqual(["off", "minimal", "low", "medium", "high"]);
	});

	it("withholds xhigh and max unless the model maps them explicitly", () => {
		// Most providers ignore these rather than downgrading, so offering them
		// would let the UI select a level that silently does nothing.
		const unmapped = supportedThinkingLevels({ reasoning: true });
		expect(unmapped).not.toContain("xhigh");
		expect(unmapped).not.toContain("max");

		const mapped = supportedThinkingLevels({
			reasoning: true,
			thinkingLevelMap: { xhigh: "high", max: "high" },
		});
		expect(mapped).toContain("xhigh");
		expect(mapped).toContain("max");
	});

	it("drops a level the model marks null", () => {
		expect(supportedThinkingLevels({ reasoning: true, thinkingLevelMap: { minimal: null } })).toEqual([
			"off",
			"low",
			"medium",
			"high",
		]);
	});

	it("keeps declared order so the UI shows least to most effort", () => {
		const levels = supportedThinkingLevels({ reasoning: true, thinkingLevelMap: { xhigh: "high" } });
		expect(levels).toEqual([...levels].sort((a, b) => THINKING_LEVELS.indexOf(a) - THINKING_LEVELS.indexOf(b)));
	});
});
