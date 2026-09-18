import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("../prime-config", () => ({ getPrimeConfig: () => ({ agentDir: mocks.agentDir }) }));

import { handleChatIntentGet, handleChatIntentPatch, handleChatIntentPost } from "../handlers/chat-intent";
import type { TypeSafeService } from "../typesafe/service";
import { setTypeSafeServiceForTests } from "../typesafe/singleton";

function stubService(overrides: Partial<TypeSafeService> = {}): TypeSafeService {
	return {
		configured: true,
		model: "jev-latest",
		status: vi.fn(async () => "ready" as const),
		routeComposerIntent: vi.fn(async () => ({
			enabled: true,
			outcome: "none" as const,
			reason: "no_match" as const,
		})),
		resetCachesForTests: vi.fn(),
		...overrides,
	};
}

function post(body: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/api/chat/intent", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		...init,
	});
}

describe("composer intent settings", () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "fleet-intent-"));
		mocks.agentDir = agentDir;
	});

	afterEach(() => {
		setTypeSafeServiceForTests(undefined);
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("reports unconfigured and off by default", async () => {
		setTypeSafeServiceForTests(stubService({ configured: false }));
		const response = await handleChatIntentGet(new Request("http://localhost/api/chat/intent"));
		expect(await response.json()).toEqual({ enabled: false, status: "unconfigured" });
	});

	it("reports readiness only through the probe", async () => {
		setTypeSafeServiceForTests(stubService());
		const response = await handleChatIntentGet(new Request("http://localhost/api/chat/intent"));
		expect(await response.json()).toEqual({ enabled: false, status: "ready" });
	});

	it("persists the toggle and never returns the key", async () => {
		setTypeSafeServiceForTests(stubService());
		const response = await handleChatIntentPatch(
			new Request("http://localhost/api/chat/intent", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: true }),
			}),
		);
		const body = (await response.json()) as Record<string, unknown>;
		expect(body).toEqual({ enabled: true, status: "ready" });
		expect(JSON.stringify(body)).not.toMatch(/key|secret|token/i);

		const persisted = JSON.parse(readFileSync(join(agentDir, "fleet-settings.json"), "utf8"));
		expect(persisted).toEqual({ version: 1, composerIntentEnabled: true });

		const readBack = await handleChatIntentGet(new Request("http://localhost/api/chat/intent"));
		expect(await readBack.json()).toMatchObject({ enabled: true });
	});
});

describe("handleChatIntentPost", () => {
	let agentDir: string;

	beforeEach(async () => {
		agentDir = mkdtempSync(join(tmpdir(), "fleet-intent-post-"));
		mocks.agentDir = agentDir;
	});

	afterEach(() => {
		setTypeSafeServiceForTests(undefined);
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("rejects a malformed body with 422", async () => {
		setTypeSafeServiceForTests(stubService());
		const response = await handleChatIntentPost(post({ text: "" }));
		expect(response.status).toBe(422);
	});

	it("rejects a cross-origin request with 403", async () => {
		const service = stubService();
		setTypeSafeServiceForTests(service);
		const response = await handleChatIntentPost(
			post(
				{ text: "show me the hotkeys" },
				{ headers: { Origin: "https://evil.example", "Content-Type": "application/json" } },
			),
		);
		expect(response.status).toBe(403);
		expect(service.routeComposerIntent).not.toHaveBeenCalled();
	});

	it("declines without calling the service when no key is configured", async () => {
		const service = stubService({ configured: false });
		setTypeSafeServiceForTests(service);
		const response = await handleChatIntentPost(post({ text: "show me the hotkeys" }));
		expect(await response.json()).toEqual({ enabled: false, outcome: "none", reason: "disabled" });
		expect(service.routeComposerIntent).not.toHaveBeenCalled();
	});

	it("does not classify while the Settings toggle is off", async () => {
		const service = stubService();
		setTypeSafeServiceForTests(service);
		await handleChatIntentPost(post({ text: "show me the hotkeys" }));
		expect(service.routeComposerIntent).toHaveBeenCalledWith(
			expect.objectContaining({ text: "show me the hotkeys" }),
			false,
		);
	});

	it("classifies once the toggle is on", async () => {
		await handleChatIntentPatch(
			new Request("http://localhost/api/chat/intent", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: true }),
			}),
		);
		const service = stubService({
			routeComposerIntent: vi.fn(async () => ({
				enabled: true,
				outcome: "matched" as const,
				command: "context",
				disposition: "execute" as const,
			})),
		});
		setTypeSafeServiceForTests(service);
		const response = await handleChatIntentPost(post({ text: "how much context is left" }));
		expect(await response.json()).toMatchObject({ outcome: "matched", command: "context", disposition: "execute" });
		expect(service.routeComposerIntent).toHaveBeenCalledWith(expect.anything(), true);
	});
});
