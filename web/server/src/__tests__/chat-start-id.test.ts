import { describe, expect, it } from "vitest";
import { chooseChatStartId } from "../handlers/chat";

describe("chooseChatStartId", () => {
	it("uses a fresh id for a normal send after an interrupted run", () => {
		const id = chooseChatStartId({ inRun: true, currentMessageId: "old-assistant" });

		expect(id).not.toBe("old-assistant");
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("reuses the active id only for a queued steer or follow-up", () => {
		const mapperState = { inRun: true, currentMessageId: "active-assistant" };

		expect(chooseChatStartId(mapperState, "steer")).toBe("active-assistant");
		expect(chooseChatStartId(mapperState, "followUp")).toBe("active-assistant");
	});

	it("starts a fresh id when there is no active assistant", () => {
		const id = chooseChatStartId({ inRun: false, currentMessageId: undefined }, "steer");

		expect(id).not.toBe("");
	});
});
