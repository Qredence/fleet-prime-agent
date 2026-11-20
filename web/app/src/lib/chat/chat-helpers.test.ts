import { describe, expect, it } from "vitest";
import {
	availableThinkingLevels,
	isErrorPart,
	isPayloadPart,
	isV5ToolPart,
	upsertAssistantPayloadPart,
	toChatMessage,
	clampThinkingLevel,
	normalizeSessionLabel,
	thinkingLevelLabel,
} from "@/lib/chat/chat-helpers";

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

describe("normalizeSessionLabel", () => {
	it("redacts credential-shaped values from transcript-derived labels", () => {
		expect(normalizeSessionLabel("add provider api key: sk-example-secret-value123")).toBe(
			"add provider api key: [redacted]",
		);
		expect(normalizeSessionLabel("use github_pat_example_secret_value")).toBe("use [redacted]");
	});
});

describe("part boundary guards", () => {
	it("validates optional error titles and payload text", () => {
		expect(isErrorPart({ type: "error", message: "failed" })).toBe(true);
		expect(isErrorPart({ type: "error", message: "failed", title: 1 })).toBe(false);
		expect(isPayloadPart({ type: "payload", kind: "bash", title: "Bash" })).toBe(true);
		expect(isPayloadPart({ type: "payload", kind: "bash", title: "Bash", text: {} })).toBe(false);
	});
	it.each(["dynamic-tool", "tool-Bash"])("validates optional tool fields for %s", (type) => {
		expect(isV5ToolPart({ type })).toBe(true);
		expect(isV5ToolPart({ type, toolCallId: "call", state: "complete" })).toBe(true);
		expect(isV5ToolPart({ type, toolCallId: 1 })).toBe(false);
		expect(isV5ToolPart({ type, state: null })).toBe(false);
	});
	it("keeps separate id-less Bash outputs while updating explicitly identified payloads", () => {
		const part = { type: "payload" as const, kind: "bash", title: "Bash", text: "first" };
		let messages = [toChatMessage("a", "assistant", [])];
		messages = upsertAssistantPayloadPart(messages, "a", part);
		messages = upsertAssistantPayloadPart(messages, "a", { ...part, text: "second" });
		messages = upsertAssistantPayloadPart(messages, "a", { ...part, id: "call" });
		messages = upsertAssistantPayloadPart(messages, "a", { ...part, id: "call", text: "updated" });
		expect(messages[0]?.parts.filter((part) => part.type === "payload").map((part) => part.text)).toEqual([
			"first",
			"second",
			"updated",
		]);
	});
});
