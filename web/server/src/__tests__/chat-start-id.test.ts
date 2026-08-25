import { describe, expect, it } from "vitest";
import { chooseChatStartId, resolveChatStreamingBehavior } from "../handlers/chat";

describe("chooseChatStartId", () => {
	it("uses a fresh id for a normal send after an interrupted run", () => {
		const id = chooseChatStartId({ inRun: true, currentMessageId: "old-assistant" });

		expect(id).not.toBe("old-assistant");
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("reuses the active id only for a queued steer or follow-up", () => {
		const mapperState = { inRun: true, currentMessageId: "active-assistant" };

		expect(chooseChatStartId(mapperState, "steer", true)).toBe("active-assistant");
		expect(chooseChatStartId(mapperState, "followUp", true)).toBe("active-assistant");
	});

	it("does not reuse a stale assistant id when the live session is idle", () => {
		const id = chooseChatStartId({ inRun: true, currentMessageId: "stale-assistant" }, "steer", false);

		expect(id).not.toBe("stale-assistant");
	});

	it("defaults legacy requests to steering and preserves explicit follow-ups", () => {
		expect(resolveChatStreamingBehavior()).toBe("steer");
		expect(resolveChatStreamingBehavior("followUp")).toBe("followUp");
	});

	it("starts a fresh id when there is no active assistant", () => {
		const id = chooseChatStartId({ inRun: false, currentMessageId: undefined }, "steer");

		expect(id).not.toBe("");
	});
});
