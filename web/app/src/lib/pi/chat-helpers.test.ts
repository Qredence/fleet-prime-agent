import {
	availableThinkingLevels,
	clampThinkingLevel,
	thinkingLevelLabel,
} from "@prime-agent/web-design/lib/pi/chat-helpers";
import { describe, expect, it } from "vitest";

describe("clampThinkingLevel", () => {
	it("keeps a level the model supports", () => {
		expect(clampThinkingLevel("max", ["off", "medium", "max"])).toBe("max");
	});

	it("falls back to medium when available, otherwise the first level", () => {
		expect(clampThinkingLevel("max", ["off", "low", "medium"])).toBe("medium");
		expect(clampThinkingLevel(undefined, ["off"])).toBe("off");
	});
});

describe("availableThinkingLevels", () => {
	it("uses catalog levels when present", () => {
		expect(availableThinkingLevels({ thinkingLevels: ["off", "high"], reasoning: true })).toEqual(["off", "high"]);
	});

	it("falls back to off for non-reasoning models without a catalog list", () => {
		expect(availableThinkingLevels({ reasoning: false })).toEqual(["off"]);
	});
});

describe("thinkingLevelLabel", () => {
	it("uses short display names for the picker trigger", () => {
		expect(thinkingLevelLabel("max")).toBe("Max");
		expect(thinkingLevelLabel("xhigh")).toBe("Extra high");
	});
});
