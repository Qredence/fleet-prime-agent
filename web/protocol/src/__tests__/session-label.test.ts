import { describe, expect, it } from "vitest";
import {
	disambiguateSessionLabel,
	EMPTY_SESSION_FIRST_MESSAGE,
	fallbackSessionLabel,
	meaningfulSessionLabel,
	sessionListTitle,
} from "../session-label";

describe("meaningfulSessionLabel", () => {
	it("drops the upstream empty-session placeholder", () => {
		expect(meaningfulSessionLabel(EMPTY_SESSION_FIRST_MESSAGE)).toBeUndefined();
		expect(meaningfulSessionLabel("  (no messages)  ")).toBeUndefined();
		expect(meaningfulSessionLabel("")).toBeUndefined();
		expect(meaningfulSessionLabel(undefined)).toBeUndefined();
	});

	it("redacts credential-shaped values", () => {
		expect(meaningfulSessionLabel("use github_pat_example_secret_value")).toBe("use [redacted]");
	});
});

describe("sessionListTitle", () => {
	it("falls back to a short session id", () => {
		expect(sessionListTitle({ sessionId: "abcdef123456", title: EMPTY_SESSION_FIRST_MESSAGE })).toBe("abcdef12");
		expect(fallbackSessionLabel("abcdef123456")).toBe("abcdef12");
	});

	it("prefers a real title over firstMessage", () => {
		expect(
			sessionListTitle({
				sessionId: "session-1",
				title: "Named session",
				firstMessage: "Hello",
			}),
		).toBe("Named session");
	});
});

describe("disambiguateSessionLabel", () => {
	it("appends the last four id characters when labels collide", () => {
		expect(disambiguateSessionLabel("Tighten the plan", "session-abcd", 1)).toBe("Tighten the plan");
		expect(disambiguateSessionLabel("Tighten the plan", "session-abcd", 2)).toBe("Tighten the plan · abcd");
		expect(disambiguateSessionLabel("plan abcd", "session-abcd", 2)).toBe("plan abcd");
	});
});
