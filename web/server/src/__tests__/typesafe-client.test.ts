import { describe, expect, it, vi } from "vitest";
import {
	choice,
	choiceAnswer,
	noulAnswer,
	postSystemOne,
	probeConnection,
	type TypeSafeFetch,
	TypeSafeTransportError,
} from "../typesafe/client";
import { readTypeSafeConfig, type TypeSafeRuntimeConfig } from "../typesafe/config";

const CONFIG: TypeSafeRuntimeConfig = {
	configured: true,
	apiKey: "test-key-not-a-real-secret",
	baseUrl: "https://typesafe.test",
	model: "jev-latest",
	intentTimeoutMs: 50,
	intentMaxRetries: 0,
	logLevel: "off",
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const ANSWER_BODY = {
	model: "jev-1.13.0",
	answers: {
		route: { type: "choice", choice: "context", confidence: 0.91, probabilities: { context: 0.91 } },
		is_code_task: { type: "noul", noul: 0.04 },
	},
	usage: { input_tokens: 800, output_tokens: 12 },
};

describe("readTypeSafeConfig", () => {
	it("is unconfigured without a key", () => {
		expect(readTypeSafeConfig({}).configured).toBe(false);
		expect(readTypeSafeConfig({ TYPESAFE_API_KEY: "   " }).configured).toBe(false);
	});

	it("honours the operator kill switch even with a key", () => {
		expect(readTypeSafeConfig({ TYPESAFE_API_KEY: "k", FLEET_TYPESAFE_ENABLED: "0" }).configured).toBe(false);
		expect(readTypeSafeConfig({ TYPESAFE_API_KEY: "k", FLEET_TYPESAFE_ENABLED: "1" }).configured).toBe(true);
	});

	it("defaults and clamps the numeric settings", () => {
		const config = readTypeSafeConfig({ TYPESAFE_API_KEY: "k" });
		expect(config.baseUrl).toBe("https://api.typesafe.ai");
		expect(config.model).toBe("jev-latest");
		expect(config.intentTimeoutMs).toBe(1_500);
		expect(config.intentMaxRetries).toBe(1);
		expect(
			readTypeSafeConfig({ TYPESAFE_API_KEY: "k", TYPESAFE_INTENT_TIMEOUT_MS: "nonsense" }).intentTimeoutMs,
		).toBe(1_500);
		expect(readTypeSafeConfig({ TYPESAFE_API_KEY: "k", TYPESAFE_INTENT_MAX_RETRIES: "-1" }).intentMaxRetries).toBe(1);
		expect(readTypeSafeConfig({ TYPESAFE_API_KEY: "k", TYPESAFE_INTENT_MAX_RETRIES: "0" }).intentMaxRetries).toBe(0);
	});

	it("strips trailing slashes from a custom base url", () => {
		expect(readTypeSafeConfig({ TYPESAFE_API_KEY: "k", TYPESAFE_BASE_URL: "https://x.test///" }).baseUrl).toBe(
			"https://x.test",
		);
	});
});

describe("postSystemOne", () => {
	it("sends the key as a bearer token and the configured model", async () => {
		const fetchImpl = vi.fn<TypeSafeFetch>(async () => jsonResponse(ANSWER_BODY));
		await postSystemOne(
			CONFIG,
			{ state: { utterance: "hi" }, questions: { route: choice("q", { a: null }) } },
			{},
			fetchImpl,
		);

		const [url, init] = fetchImpl.mock.calls[0] ?? [];
		expect(url).toBe("https://typesafe.test/v1/systemone");
		expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key-not-a-real-secret");
		expect(JSON.parse(String(init?.body))).toMatchObject({ model: "jev-latest" });
	});

	it("returns typed answers", async () => {
		const result = await postSystemOne(CONFIG, { state: {}, questions: {} }, {}, async () =>
			jsonResponse(ANSWER_BODY),
		);
		expect(choiceAnswer(result, "route")?.choice).toBe("context");
		expect(noulAnswer(result, "is_code_task")?.noul).toBe(0.04);
		expect(result.usage.input_tokens).toBe(800);
		expect(choiceAnswer(result, "is_code_task")).toBeUndefined();
		expect(noulAnswer(result, "missing")).toBeUndefined();
	});

	it("refuses to send anything when unconfigured", async () => {
		const fetchImpl = vi.fn<TypeSafeFetch>(async () => jsonResponse(ANSWER_BODY));
		await expect(
			postSystemOne({ ...CONFIG, configured: false }, { state: {}, questions: {} }, {}, fetchImpl),
		).rejects.toMatchObject({ kind: "unconfigured" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("surfaces a non-2xx status without leaking the body or the key", async () => {
		const fetchImpl: TypeSafeFetch = async () =>
			new Response("upstream detail: api_key=leaked-value", { status: 500 });
		const error = await postSystemOne(CONFIG, { state: {}, questions: {} }, {}, fetchImpl).catch((e) => e);
		expect(error).toBeInstanceOf(TypeSafeTransportError);
		expect(error.kind).toBe("http");
		expect(error.status).toBe(500);
		expect(String(error.message)).not.toContain("leaked-value");
		expect(String(error.message)).not.toContain(CONFIG.apiKey);
	});

	it("treats an unreadable body as malformed rather than throwing raw", async () => {
		const fetchImpl: TypeSafeFetch = async () => new Response("not json at all", { status: 200 });
		await expect(postSystemOne(CONFIG, { state: {}, questions: {} }, {}, fetchImpl)).rejects.toMatchObject({
			kind: "malformed",
		});
	});

	it("performs exactly one attempt when retries are disabled", async () => {
		const fetchImpl = vi.fn<TypeSafeFetch>(async () => new Response("", { status: 503 }));
		await expect(postSystemOne(CONFIG, { state: {}, questions: {} }, {}, fetchImpl)).rejects.toMatchObject({
			status: 503,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("retries only the statuses it is told to", async () => {
		const retrying = vi.fn<TypeSafeFetch>(async () => new Response("", { status: 429 }));
		await expect(
			postSystemOne(
				CONFIG,
				{ state: {}, questions: {} },
				{ maxRetries: 2, retryStatuses: new Set([429]) },
				retrying,
			),
		).rejects.toMatchObject({ status: 429 });
		expect(retrying).toHaveBeenCalledTimes(3);

		const notRetrying = vi.fn<TypeSafeFetch>(async () => new Response("", { status: 422 }));
		await expect(
			postSystemOne(
				CONFIG,
				{ state: {}, questions: {} },
				{ maxRetries: 2, retryStatuses: new Set([429]) },
				notRetrying,
			),
		).rejects.toMatchObject({ status: 422 });
		expect(notRetrying).toHaveBeenCalledTimes(1);
	});

	it("reports a timeout as a timeout", async () => {
		const fetchImpl: TypeSafeFetch = (_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
			});
		await expect(
			postSystemOne(CONFIG, { state: {}, questions: {} }, { timeoutMs: 20 }, fetchImpl),
		).rejects.toMatchObject({ kind: "timeout" });
	});
});

describe("probeConnection", () => {
	it("is false when unconfigured, without calling the network", async () => {
		const fetchImpl = vi.fn<TypeSafeFetch>(async () => jsonResponse({ models: [] }));
		expect(await probeConnection({ ...CONFIG, configured: false }, fetchImpl)).toBe(false);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("reports reachability from the status code", async () => {
		expect(await probeConnection(CONFIG, async () => jsonResponse({ models: [] }))).toBe(true);
		expect(await probeConnection(CONFIG, async () => new Response("", { status: 401 }))).toBe(false);
		expect(
			await probeConnection(CONFIG, async () => {
				throw new Error("offline");
			}),
		).toBe(false);
	});
});
