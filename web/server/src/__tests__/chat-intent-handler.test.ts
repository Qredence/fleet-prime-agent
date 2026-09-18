import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComposerIntentResponse } from "@prime-agent/web-protocol/composer-intent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The auth store is an in-memory map, mirroring how
 * `chat-providers-handler.test.ts` stubs credential storage. Nothing here may
 * touch the real store or the network, and every value is a literal placeholder.
 */
const mocks = vi.hoisted(() => ({
	agentDir: "",
	credentials: new Map<string, string>(),
	reloadAuth: vi.fn(),
	resetTypeSafeService: vi.fn(),
	routeComposerIntent: vi.fn(
		async (): Promise<ComposerIntentResponse> => ({ enabled: true, outcome: "none", reason: "no_match" }),
	),
	forceConfigured: undefined as boolean | undefined,
}));

vi.mock("../prime-config", () => ({
	getPrimeConfig: () => ({
		agentDir: mocks.agentDir,
		authStorage: {
			get: (id: string) =>
				mocks.credentials.has(id) ? { type: "api_key", key: mocks.credentials.get(id) } : undefined,
			set: (id: string, credential: { key: string }) => void mocks.credentials.set(id, credential.key),
			remove: (id: string) => void mocks.credentials.delete(id),
			has: (id: string) => mocks.credentials.has(id),
		},
		reloadAuth: mocks.reloadAuth,
	}),
}));

vi.mock("../typesafe/singleton", () => ({
	getTypeSafeService: () => {
		const configured =
			mocks.forceConfigured ?? (mocks.credentials.has("typesafe") || Boolean(process.env.TYPESAFE_API_KEY));
		return {
			configured,
			model: "jev-latest",
			status: vi.fn(async () => (configured ? ("ready" as const) : ("unconfigured" as const))),
			routeComposerIntent: mocks.routeComposerIntent,
			resetCachesForTests: vi.fn(),
		};
	},
	resetTypeSafeService: mocks.resetTypeSafeService,
}));

import {
	handleChatIntentGet,
	handleChatIntentPatch,
	handleChatIntentPost,
	handleChatIntentPut,
} from "../handlers/chat-intent";

function request(method: string, body?: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/chat/intent", {
		method,
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		...init,
	});
}

describe("composer intent settings", () => {
	let agentDir: string;
	let originalKey: string | undefined;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "fleet-intent-"));
		mocks.agentDir = agentDir;
		mocks.credentials.clear();
		mocks.forceConfigured = undefined;
		mocks.reloadAuth.mockReset();
		mocks.resetTypeSafeService.mockReset();
		// The developer shell may export a real key; the source assertions below
		// depend on the environment being clean.
		originalKey = process.env.TYPESAFE_API_KEY;
		delete process.env.TYPESAFE_API_KEY;
	});

	afterEach(() => {
		if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
		else process.env.TYPESAFE_API_KEY = originalKey;
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("reports unconfigured and off by default", async () => {
		const response = await handleChatIntentGet(request("GET"));
		expect(await response.json()).toEqual({ enabled: false, keySource: "none", status: "unconfigured" });
	});

	it("reports readiness only through the probe, and the environment as the source", async () => {
		process.env.TYPESAFE_API_KEY = "ts-test-environment-key";
		const response = await handleChatIntentGet(request("GET"));
		expect(await response.json()).toEqual({ enabled: false, keySource: "environment", status: "ready" });
	});

	it("persists the toggle and never returns the key", async () => {
		const response = await handleChatIntentPatch(request("PATCH", { enabled: true }));
		const body = (await response.json()) as Record<string, unknown>;
		expect(body).toEqual({ enabled: true, keySource: "none", status: "unconfigured" });
		// The projection names its source field `keySource`, so the guard is on
		// marker words for leaked material rather than on the substring "key" —
		// that the value itself is never echoed is asserted in the PUT cases below.
		expect(JSON.stringify(body)).not.toMatch(/secret|token|credential/i);

		const persisted = JSON.parse(readFileSync(join(agentDir, "fleet-settings.json"), "utf8"));
		expect(persisted).toEqual({ version: 1, composerIntentEnabled: true });

		const readBack = await handleChatIntentGet(request("GET"));
		expect(await readBack.json()).toMatchObject({ enabled: true });
	});
});

describe("handleChatIntentPut", () => {
	let agentDir: string;
	let originalKey: string | undefined;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "fleet-intent-put-"));
		mocks.agentDir = agentDir;
		mocks.credentials.clear();
		mocks.forceConfigured = undefined;
		mocks.reloadAuth.mockReset();
		mocks.resetTypeSafeService.mockReset();
		// Restored verbatim afterwards: a worker that started with a value must
		// not have it silently deleted for the tests that follow.
		originalKey = process.env.TYPESAFE_API_KEY;
		delete process.env.TYPESAFE_API_KEY;
	});

	afterEach(() => {
		if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
		else process.env.TYPESAFE_API_KEY = originalKey;
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("stores the key and reports it as the source, without echoing it", async () => {
		const response = await handleChatIntentPut(request("PUT", { apiKey: "  ts-test-placeholder-key  " }));
		const body = (await response.json()) as Record<string, unknown>;

		// Trimmed on the way in, and reportable only as a source.
		expect(mocks.credentials.get("typesafe")).toBe("ts-test-placeholder-key");
		expect(body).toEqual({ enabled: false, keySource: "settings", status: "ready" });
		expect(JSON.stringify(body)).not.toContain("ts-test-placeholder-key");
		expect(JSON.stringify(body)).not.toMatch(/secret|token/i);
		expect(mocks.reloadAuth).toHaveBeenCalled();
	});

	it("drops the memoised service so the new key takes effect without a restart", async () => {
		await handleChatIntentPut(request("PUT", { apiKey: "ts-test-placeholder-key" }));
		expect(mocks.resetTypeSafeService).toHaveBeenCalled();
	});

	it("clears the stored key when given null, falling back to the environment", async () => {
		mocks.credentials.set("typesafe", "ts-test-placeholder-key");
		process.env.TYPESAFE_API_KEY = "ts-test-environment-key";
		const response = await handleChatIntentPut(request("PUT", { apiKey: null }));
		expect(mocks.credentials.has("typesafe")).toBe(false);
		expect(await response.json()).toEqual({ enabled: false, keySource: "environment", status: "ready" });
	});

	it("rejects an empty key with 422 rather than storing a blank credential", async () => {
		const response = await handleChatIntentPut(request("PUT", { apiKey: "   " }));
		expect(response.status).toBe(422);
		expect(mocks.credentials.size).toBe(0);
	});

	it("rejects a cross-origin request with 403 and stores nothing", async () => {
		const response = await handleChatIntentPut(
			request(
				"PUT",
				{ apiKey: "ts-test-placeholder-key" },
				{ headers: { Origin: "https://evil.example", "Content-Type": "application/json" } },
			),
		);
		expect(response.status).toBe(403);
		expect(mocks.credentials.size).toBe(0);
	});
});

describe("handleChatIntentPost", () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "fleet-intent-post-"));
		mocks.agentDir = agentDir;
		mocks.forceConfigured = undefined;
		mocks.routeComposerIntent.mockClear();
	});

	afterEach(() => {
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("rejects a malformed body with 422", async () => {
		mocks.forceConfigured = true;
		expect((await handleChatIntentPost(request("POST", { text: "" }))).status).toBe(422);
	});

	it("rejects a cross-origin request with 403", async () => {
		mocks.forceConfigured = true;
		const response = await handleChatIntentPost(
			request(
				"POST",
				{ text: "show me the hotkeys" },
				{ headers: { Origin: "https://evil.example", "Content-Type": "application/json" } },
			),
		);
		expect(response.status).toBe(403);
		expect(mocks.routeComposerIntent).not.toHaveBeenCalled();
	});

	it("declines without calling the service when no key is configured", async () => {
		mocks.forceConfigured = false;
		const response = await handleChatIntentPost(request("POST", { text: "show me the hotkeys" }));
		expect(await response.json()).toEqual({ enabled: false, outcome: "none", reason: "disabled" });
		expect(mocks.routeComposerIntent).not.toHaveBeenCalled();
	});

	it("does not classify while the Settings toggle is off", async () => {
		mocks.forceConfigured = true;
		await handleChatIntentPost(request("POST", { text: "show me the hotkeys" }));
		expect(mocks.routeComposerIntent).toHaveBeenCalledWith(
			expect.objectContaining({ text: "show me the hotkeys" }),
			false,
		);
	});

	it("classifies once the toggle is on", async () => {
		mocks.forceConfigured = true;
		await handleChatIntentPatch(request("PATCH", { enabled: true }));
		mocks.routeComposerIntent.mockResolvedValueOnce({
			enabled: true,
			outcome: "matched",
			command: "context",
			disposition: "execute",
		});
		const response = await handleChatIntentPost(request("POST", { text: "how much context is left" }));
		expect(await response.json()).toMatchObject({ outcome: "matched", command: "context", disposition: "execute" });
		expect(mocks.routeComposerIntent).toHaveBeenCalledWith(expect.anything(), true);
	});
});
