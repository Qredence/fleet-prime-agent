import { COMPOSER_INTENT_COMMANDS } from "@prime-agent/web-protocol/composer-intent";
import { describe, expect, it, vi } from "vitest";
import type { TypeSafeFetch } from "../typesafe/client";
import type { TypeSafeRuntimeConfig } from "../typesafe/config";
import {
	buildIntentQuestions,
	buildIntentState,
	INTENT_CODE_TASK_QUESTION_ID,
	INTENT_ROUTE_QUESTION_ID,
	interpretIntentResult,
} from "../typesafe/intent-router";
import { createTypeSafeService, normalizeIntentText } from "../typesafe/service";

const CONFIG: TypeSafeRuntimeConfig = {
	configured: true,
	apiKey: "test-key-not-a-real-secret",
	baseUrl: "https://typesafe.test",
	model: "jev-latest",
	intentTimeoutMs: 50,
	intentMaxRetries: 0,
	logLevel: "off",
};

function answer(command: string, confidence: number, codeTask: number): Response {
	return new Response(
		JSON.stringify({
			model: "jev-1.13.0",
			answers: {
				[INTENT_ROUTE_QUESTION_ID]: {
					type: "choice",
					choice: command,
					confidence,
					probabilities: { [command]: confidence },
				},
				[INTENT_CODE_TASK_QUESTION_ID]: { type: "noul", noul: codeTask },
			},
			usage: { input_tokens: 800, output_tokens: 10 },
		}),
		{ status: 200 },
	);
}

describe("buildIntentState", () => {
	it("carries the code-owned catalog, never caller-supplied descriptions", () => {
		const state = buildIntentState("show me the shortcuts");
		expect(state.utterance).toBe("show me the shortcuts");
		expect(state.commands.map((c) => c.id)).toEqual(COMPOSER_INTENT_COMMANDS.map((c) => c.id));
		expect(state.commands.every((c) => c.what.length > 10)).toBe(true);
	});

	it("truncates a very long draft", () => {
		expect(buildIntentState("x".repeat(5_000)).utterance.length).toBe(1_000);
	});
});

describe("buildIntentQuestions", () => {
	it("asks both questions in one request, with a no-match option", () => {
		const questions = buildIntentQuestions();
		expect(Object.keys(questions)).toEqual([INTENT_ROUTE_QUESTION_ID, INTENT_CODE_TASK_QUESTION_ID]);
		const route = questions[INTENT_ROUTE_QUESTION_ID];
		expect(route?.type).toBe("choice");
		if (route?.type !== "choice") throw new Error("expected a choice question");
		expect(Object.keys(route.criteria)).toEqual(
			expect.arrayContaining(["none", ...COMPOSER_INTENT_COMMANDS.map((c) => c.id)]),
		);
		expect(questions[INTENT_CODE_TASK_QUESTION_ID]?.type).toBe("noul");
	});
});

describe("interpretIntentResult", () => {
	const result = (command: string, confidence: number, codeTask: number) => ({
		model: "jev-1.13.0",
		answers: {
			[INTENT_ROUTE_QUESTION_ID]: { type: "choice" as const, choice: command, confidence, probabilities: {} },
			[INTENT_CODE_TASK_QUESTION_ID]: { type: "noul" as const, noul: codeTask },
		},
		usage: { input_tokens: 1, output_tokens: 1 },
	});

	it("maps a confident safe match to an execute disposition", () => {
		expect(interpretIntentResult(result("context", 0.93, 0.02))).toMatchObject({
			outcome: "matched",
			disposition: "execute",
			confidence: 0.93,
			command: { id: "context" },
		});
	});

	it("refuses when the utterance is engineering work, however confident", () => {
		expect(interpretIntentResult(result("context", 0.99, 0.95))).toEqual({ outcome: "none", reason: "code_task" });
	});

	it("treats a missing answer as no match rather than an error", () => {
		expect(interpretIntentResult({ model: "m", answers: {}, usage: { input_tokens: 0, output_tokens: 0 } })).toEqual({
			outcome: "none",
			reason: "no_match",
		});
	});

	it("rejects a command that is not in the catalog", () => {
		expect(interpretIntentResult(result("not-a-command", 0.99, 0))).toEqual({
			outcome: "none",
			reason: "no_match",
		});
	});
});

describe("normalizeIntentText", () => {
	it("collapses case and whitespace so typing does not miss the cache", () => {
		expect(normalizeIntentText("  Show   Me  The Hotkeys ")).toBe("show me the hotkeys");
	});
});

describe("createTypeSafeService", () => {
	const service = (fetchImpl: TypeSafeFetch, config = CONFIG) => createTypeSafeService({ config, fetch: fetchImpl });

	it("never calls the network when the user has the feature off", async () => {
		const fetchImpl = vi.fn<TypeSafeFetch>(async () => answer("context", 0.99, 0));
		const response = await service(fetchImpl).routeComposerIntent({ text: "how much context is left" }, false);
		expect(response).toEqual({ enabled: false, outcome: "none", reason: "disabled" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("never calls the network when no key is configured", async () => {
		const fetchImpl = vi.fn<TypeSafeFetch>(async () => answer("context", 0.99, 0));
		const response = await service(fetchImpl, { ...CONFIG, configured: false }).routeComposerIntent(
			{ text: "how much context is left" },
			true,
		);
		expect(response).toEqual({ enabled: false, outcome: "none", reason: "disabled" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("routes a confident safe match", async () => {
		const response = await service(async () => answer("context", 0.93, 0.02)).routeComposerIntent(
			{ text: "how much context have I used?" },
			true,
		);
		expect(response).toMatchObject({ enabled: true, outcome: "matched", command: "context", disposition: "execute" });
	});

	it("offers a non-auto command instead of running it", async () => {
		const response = await service(async () => answer("compact", 0.95, 0.02)).routeComposerIntent(
			{ text: "this is getting long, compact it" },
			true,
		);
		expect(response).toMatchObject({ outcome: "matched", command: "compact", disposition: "suggest" });
	});

	it("sends genuine coding requests through to the agent", async () => {
		const response = await service(async () => answer("none", 0.9, 0.95)).routeComposerIntent(
			{ text: "refactor the auth middleware and add tests" },
			true,
		);
		expect(response).toMatchObject({ outcome: "none", reason: "code_task" });
	});

	it("falls through on a low-confidence match", async () => {
		const response = await service(async () => answer("copy", 0.41, 0.1)).routeComposerIntent(
			{ text: "make me a dashboard for the release pipeline" },
			true,
		);
		expect(response).toMatchObject({ outcome: "none", reason: "below_floor" });
	});

	it("skips a draft short enough to be nothing, and an explicit slash command", async () => {
		const fetchImpl = vi.fn<TypeSafeFetch>(async () => answer("context", 0.99, 0));
		const svc = service(fetchImpl);
		expect(await svc.routeComposerIntent({ text: "hi" }, true)).toMatchObject({ reason: "empty" });
		expect(await svc.routeComposerIntent({ text: "/compact" }, true)).toMatchObject({ reason: "empty" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("caches a decision, including a negative one", async () => {
		const fetchImpl = vi.fn<TypeSafeFetch>(async () => answer("none", 0.9, 0.95));
		const svc = service(fetchImpl);
		for (const text of ["refactor the parser", "  Refactor   The Parser  ", "refactor the parser"]) {
			expect(await svc.routeComposerIntent({ text }, true)).toMatchObject({ outcome: "none" });
		}
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("fails open on a transport error", async () => {
		const response = await service(async () => {
			throw new Error("socket exploded");
		}).routeComposerIntent({ text: "how much context is left" }, true);
		expect(response).toEqual({ enabled: true, outcome: "none", reason: "unavailable" });
	});

	it("distinguishes a rate limit from an outright failure", async () => {
		const response = await service(async () => new Response("", { status: 429 })).routeComposerIntent(
			{ text: "how much context is left" },
			true,
		);
		expect(response).toMatchObject({ outcome: "none", reason: "rate_limited" });
	});

	it("fails open on an unreadable body", async () => {
		const response = await service(async () => new Response("not json", { status: 200 })).routeComposerIntent(
			{ text: "how much context is left" },
			true,
		);
		expect(response).toMatchObject({ outcome: "none", reason: "unavailable" });
	});

	it("reports readiness only after a successful probe, and caches it", async () => {
		const fetchImpl = vi.fn<TypeSafeFetch>(async () => new Response("{}", { status: 200 }));
		const svc = service(fetchImpl);
		expect(await svc.status()).toBe("ready");
		expect(await svc.status()).toBe("ready");
		expect(fetchImpl).toHaveBeenCalledTimes(1);

		expect(await service(async () => new Response("", { status: 401 })).status()).toBe("error");
		expect(
			await service(async () => new Response("", { status: 200 }), { ...CONFIG, configured: false }).status(),
		).toBe("unconfigured");
	});
});
