import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDashboardServiceForTests } from "../dashboards/cloud";
import { dashboardPromptContext } from "../dashboards/prompt-context";
import * as dashboardUsers from "../dashboards/user-id";

const mocks = vi.hoisted(() => ({
	agentDir: "",
	session: { sessionId: "session-1", projectId: "project-1" },
	presentation: { artifactRuns: [] as Array<{ artifacts: Array<Record<string, unknown>> }> },
}));

vi.mock("../prime-config", () => ({
	getPrimeConfig: () => ({ agentDir: mocks.agentDir, reloadAuth: vi.fn() }),
}));

vi.mock("../handlers/session-access", async () => {
	const { getBridge } = await import("../singleton");
	const requireProjectSession = async (session: unknown) => Boolean(session);
	return {
		requireProjectSession,
		requireSession: async (sessionId: string) => {
			const bridge = getBridge();
			const session = bridge.getSession(sessionId) ?? (await bridge.resumeSessionById(sessionId));
			if (!session || !(await requireProjectSession(session))) return undefined;
			return session;
		},
	};
});

vi.mock("../singleton", () => ({
	getBridge: () => ({
		getSession: (id: string) => (id === mocks.session.sessionId ? mocks.session : undefined),
		resumeSessionById: async () => undefined,
		getMessages: async () => [],
		getPresentation: () => mocks.presentation,
		upsertPresentationArtifact: async (_sessionId: string, artifact: { id: string }) => {
			const existing = mocks.presentation.artifactRuns.flatMap((run) => run.artifacts);
			const next = existing.some((item) => item.id === artifact.id)
				? existing.map((item) => (item.id === artifact.id ? artifact : item))
				: [...existing, artifact];
			mocks.presentation = { artifactRuns: [{ artifacts: next }] };
			return mocks.presentation;
		},
	}),
}));

import {
	handleDashboardsGet,
	handleDashboardsInterpreterPost,
	handleDashboardsPut,
	handleDashboardsTokenPost,
	settleDashboardMessage,
} from "../handlers/dashboards";

function request(method: string, body?: unknown): Request {
	return new Request("http://127.0.0.1/api/chat/dashboards", {
		method,
		headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

function message(body: Record<string, unknown>): string {
	return `\`\`\`openui-dashboard\n${JSON.stringify(body)}\n\`\`\``;
}

function storedArtifacts(): Array<Record<string, unknown>> {
	return mocks.presentation.artifactRuns.flatMap((run) => run.artifacts);
}

function cloudCreated(id: string): string {
	return `created ]]>openui:content?artifact_id=${id}&type=dashboard`;
}

function cloudService(
	overrides: {
		create?: () => Promise<string>;
		edit?: (params: { id: string; prompt: string }) => Promise<string>;
	} = {},
) {
	setDashboardServiceForTests({
		create: overrides.create ?? (async () => cloudCreated("art_test")),
		edit: overrides.edit ?? (async ({ id, prompt }) => `edited ${id}: ${prompt}`),
		interpreter: { execute: async () => ({ rows: [] }) },
		createFrontendToken: async () => ({ token: "fct_test", expires_at: 1 }),
	});
}

describe("dashboard settings and creation", () => {
	let agentDir: string;
	let originalKey: string | undefined;
	let originalAlias: string | undefined;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "fleet-dashboards-"));
		mocks.agentDir = agentDir;
		mocks.presentation = { artifactRuns: [] };
		originalKey = process.env.THESYS_API_KEY;
		originalAlias = process.env.THESIS_API_KEY;
		delete process.env.THESYS_API_KEY;
		delete process.env.THESIS_API_KEY;
		setDashboardServiceForTests(null);
	});

	afterEach(() => {
		if (originalKey === undefined) delete process.env.THESYS_API_KEY;
		else process.env.THESYS_API_KEY = originalKey;
		if (originalAlias === undefined) delete process.env.THESIS_API_KEY;
		else process.env.THESIS_API_KEY = originalAlias;
		setDashboardServiceForTests(null);
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("reports self-hosted when no key is configured", async () => {
		const body = await (await handleDashboardsGet(request("GET"))).json();
		expect(body).toEqual({
			configured: false,
			keySource: "none",
			mode: "self-hosted",
			model: "anthropic/claude-sonnet-5.5",
			modelSource: "default",
		});
		expect(JSON.stringify(body)).not.toContain("THESYS_API_KEY");
	});

	it("prefers a saved key over the environment and never returns the value", async () => {
		process.env.THESYS_API_KEY = "env-key";
		const saved = await (await handleDashboardsPut(request("PUT", { apiKey: "stored-key" }))).json();
		expect(saved).toEqual({
			configured: true,
			keySource: "settings",
			mode: "cloud",
			model: "anthropic/claude-sonnet-5.5",
			modelSource: "default",
		});
		expect(JSON.stringify(saved)).not.toContain("stored-key");
		expect(JSON.stringify(saved)).not.toContain("env-key");
	});

	it("ignores THESIS_API_KEY", async () => {
		process.env.THESIS_API_KEY = "alias-key";
		const body = await (await handleDashboardsGet(request("GET"))).json();
		expect(body).toMatchObject({ configured: false, keySource: "none", mode: "self-hosted" });
		expect(JSON.stringify(body)).not.toContain("alias-key");
	});

	it("rejects an empty key and a bare model before storing them", async () => {
		const emptyKey = await handleDashboardsPut(request("PUT", { apiKey: "   " }));
		expect(emptyKey.status).toBe(422);
		const bareModel = await handleDashboardsPut(request("PUT", { model: "claude-sonnet" }));
		expect(bareModel.status).toBe(422);
		await expect(readFile(join(agentDir, "thesys.json"), "utf8")).rejects.toThrow();
		const saved = await (await handleDashboardsPut(request("PUT", { model: "openai/gpt-6-sol" }))).json();
		expect(saved).toMatchObject({ model: "openai/gpt-6-sol", modelSource: "settings" });
	});

	it("stores and clears a dashboard model", async () => {
		process.env.THESYS_API_KEY = "env-key";
		const saved = await (await handleDashboardsPut(request("PUT", { model: "openai/gpt-6-sol" }))).json();
		expect(saved).toMatchObject({ model: "openai/gpt-6-sol", modelSource: "settings", mode: "cloud" });
		const cleared = await (await handleDashboardsPut(request("PUT", { model: null }))).json();
		expect(cleared).toMatchObject({ modelSource: "default", model: "anthropic/claude-sonnet-5.5" });
	});

	it("resolves the dashboard model from the environment before the default", async () => {
		process.env.THESYS_API_KEY = "env-key";
		const original = process.env.FLEET_DASHBOARD_MODEL;
		process.env.FLEET_DASHBOARD_MODEL = "openai/gpt-6-sol";
		try {
			const body = await (await handleDashboardsGet(request("GET"))).json();
			expect(body).toMatchObject({ model: "openai/gpt-6-sol", modelSource: "environment" });
		} finally {
			if (original === undefined) delete process.env.FLEET_DASHBOARD_MODEL;
			else process.env.FLEET_DASHBOARD_MODEL = original;
		}
	});

	it("leaves unrelated settings untouched when only the key changes", async () => {
		await handleDashboardsPut(request("PUT", { model: "openai/gpt-6-sol" }));
		await handleDashboardsPut(request("PUT", { apiKey: "stored-key" }));
		const body = await (await handleDashboardsGet(request("GET"))).json();
		expect(body).toMatchObject({ keySource: "settings", model: "openai/gpt-6-sol" });
	});

	it("falls back to the environment key after the saved key is cleared", async () => {
		process.env.THESYS_API_KEY = "env-key";
		await handleDashboardsPut(request("PUT", { apiKey: "stored-key" }));
		const cleared = await (await handleDashboardsPut(request("PUT", { apiKey: null }))).json();
		expect(cleared).toEqual({
			configured: true,
			keySource: "environment",
			mode: "cloud",
			model: "anthropic/claude-sonnet-5.5",
			modelSource: "default",
		});
		expect(JSON.stringify(cleared)).not.toContain("env-key");
	});

	it("stores a local program without calling Cloud", async () => {
		let calls = 0;
		cloudService({
			create: async () => {
				calls += 1;
				return "created";
			},
		});
		const stored = await settleDashboardMessage(
			"session-1",
			"message-1",
			message({ title: "Orders", program: "root = Dashboard([])" }),
		);
		expect(calls).toBe(0);
		expect(stored?.output).toMatchObject({ mode: "local", program: "root = Dashboard([])" });
	});

	it("updates a local board when the fence carries its id", async () => {
		const created = await settleDashboardMessage(
			"session-1",
			"message-1",
			message({ title: "Orders", program: "root = Dashboard([])" }),
		);
		const edited = await settleDashboardMessage(
			"session-1",
			"message-2",
			message({ id: created?.id, title: "Orders", program: "root = Dashboard([header])" }),
		);
		expect(storedArtifacts()).toHaveLength(1);
		expect(edited?.id).toBe(created?.id);
		expect(edited?.output).toMatchObject({ mode: "local", program: "root = Dashboard([header])" });
		const context = await dashboardPromptContext({
			artifactRuns: mocks.presentation.artifactRuns,
		} as PrimeAgentSessionPresentation);
		expect(context).toEqual({ mode: "self-hosted", latestDashboardId: created?.id });
	});

	it("creates another local board when the program fence has no id", async () => {
		await settleDashboardMessage("session-1", "message-1", message({ program: "root = Dashboard([])" }));
		await settleDashboardMessage("session-1", "message-2", message({ program: "root = Dashboard([header])" }));
		expect(storedArtifacts()).toHaveLength(2);
	});

	it("stores an error when settling throws after the fence is known", async () => {
		process.env.THESYS_API_KEY = "env-key";
		cloudService();
		const spy = vi.spyOn(dashboardUsers, "dashboardUserId").mockRejectedValueOnce(new Error("disk down"));
		try {
			const stored = await settleDashboardMessage("session-1", "message-1", message({ prompt: "orders" }));
			expect(stored?.output).toMatchObject({ mode: "cloud", error: "disk down" });
			expect(stored?.output).not.toHaveProperty("response");
		} finally {
			spy.mockRestore();
		}
	});

	it("does not mint a user id when the legacy file cannot be read", async () => {
		await mkdir(join(agentDir, "dashboard-user-id"));
		await expect(dashboardUsers.dashboardUserId()).rejects.toThrow();
		await expect(readFile(join(agentDir, "thesys.json"), "utf8")).rejects.toThrow();
	});

	it("keeps one cloud user id on thesys.json and copies a legacy file once", async () => {
		await writeFile(join(agentDir, "dashboard-user-id"), "fleet-legacy\n");
		expect(await dashboardUsers.dashboardUserId()).toBe("fleet-legacy");
		expect(await dashboardUsers.dashboardUserId()).toBe("fleet-legacy");
		const stored = JSON.parse(await readFile(join(agentDir, "thesys.json"), "utf8")) as { userId?: string };
		expect(stored.userId).toBe("fleet-legacy");
		expect(await readFile(join(agentDir, "dashboard-user-id"), "utf8")).toBe("fleet-legacy\n");
	});

	it("mints one user id without dropping a saved key", async () => {
		await handleDashboardsPut(request("PUT", { apiKey: "stored-key" }));
		const first = await dashboardUsers.dashboardUserId();
		const second = await dashboardUsers.dashboardUserId();
		expect(second).toBe(first);
		expect(first.startsWith("fleet-")).toBe(true);
		const stored = JSON.parse(await readFile(join(agentDir, "thesys.json"), "utf8")) as {
			key?: string;
			userId?: string;
		};
		expect(stored).toMatchObject({ key: "stored-key", userId: first });
	});

	it("leaves a board saved by an older version unread", async () => {
		mocks.presentation = {
			artifactRuns: [
				{
					artifacts: [
						{
							id: "old",
							runId: "run",
							sourceMessageId: "message-1",
							kind: "openui-dashboard",
							title: "Old",
							status: "success",
							timestamp: 1,
							output: { mode: "self-hosted", program: "old" },
						},
					],
				},
			],
		};
		expect(
			await settleDashboardMessage("session-1", "message-1", message({ program: "root = Dashboard([])" })),
		).toBeUndefined();
		expect(storedArtifacts()).toHaveLength(1);
		expect(storedArtifacts()[0]?.output).toMatchObject({ mode: "self-hosted" });
	});

	it("stores fence rows and keeps them when an edit omits rows", async () => {
		process.env.THESYS_API_KEY = "env-key";
		cloudService();
		const columns = [{ key: "seats", label: "Seats", type: "number" }];
		const created = await settleDashboardMessage(
			"session-1",
			"message-1",
			message({ title: "Orders", prompt: "orders", columns, rows: [{ seats: 250 }] }),
		);
		expect(created?.output).toMatchObject({ dataset: { columns, rows: [{ seats: 250 }] } });
		const edited = await settleDashboardMessage(
			"session-1",
			"message-2",
			message({ id: "art_test", prompt: "add a filter" }),
		);
		expect(edited?.output).toMatchObject({
			dataset: { rows: [{ seats: 250 }] },
			response: expect.stringContaining("edited"),
		});
	});

	it("replaces stored rows when an edit includes rows", async () => {
		process.env.THESYS_API_KEY = "env-key";
		cloudService();
		const columns = [{ key: "seats", label: "Seats", type: "number" }];
		await settleDashboardMessage(
			"session-1",
			"message-1",
			message({ prompt: "orders", columns, rows: [{ seats: 250 }] }),
		);
		const edited = await settleDashboardMessage(
			"session-1",
			"message-2",
			message({ id: "art_test", prompt: "add a filter", columns, rows: [{ seats: 157 }] }),
		);
		expect(edited?.output).toMatchObject({ dataset: { rows: [{ seats: 157 }] } });
	});

	it("records a scrubbed error when a prompt fence has no key", async () => {
		const stored = await settleDashboardMessage(
			"session-1",
			"message-1",
			message({ title: "Orders", prompt: "orders" }),
		);
		expect(stored?.output).toMatchObject({ mode: "cloud", error: expect.stringContaining("Thesys") });
		expect((stored?.output as { response?: string }).response).toBeUndefined();
	});

	it("stores the cloud response once and does not echo the key", async () => {
		process.env.THESYS_API_KEY = "env-key";
		let calls = 0;
		cloudService({
			create: async () => {
				calls += 1;
				return cloudCreated("art_test");
			},
		});
		const content = message({ title: "Orders", prompt: "orders by day" });
		const created = await settleDashboardMessage("session-1", "message-1", content);
		expect(created?.output).toMatchObject({
			mode: "cloud",
			response: cloudCreated("art_test"),
			dashboardId: "art_test",
		});
		expect(created?.sourceMessageId).toBe("message-1");
		expect(JSON.stringify(created)).not.toContain("env-key");
		await settleDashboardMessage("session-1", "message-1", content);
		expect(calls).toBe(1);

		const token = await (
			await handleDashboardsTokenPost(
				new Request("http://127.0.0.1/api/chat/dashboards/token", {
					method: "POST",
					headers: { Origin: "http://127.0.0.1" },
				}),
			)
		).json();
		expect(token).toEqual({ token: "fct_test", expires_at: 1 });
		expect(JSON.stringify(token)).not.toContain("env-key");
	});

	it("patches a cloud edit onto the original artifact", async () => {
		process.env.THESYS_API_KEY = "env-key";
		cloudService();
		const created = await settleDashboardMessage(
			"session-1",
			"message-1",
			message({ title: "Orders", prompt: "orders by day" }),
		);
		const edited = await settleDashboardMessage(
			"session-1",
			"message-2",
			message({ id: "art_test", prompt: "add a status filter" }),
		);
		expect(edited?.id).toBe(created?.id);
		expect(edited?.output).toMatchObject({ response: "edited art_test: add a status filter" });
		expect(edited?.title).toBe("Orders");
		expect(edited?.sourceMessageId).toBe("message-1");
		expect(storedArtifacts()).toHaveLength(1);
	});

	it("keeps the previous board when an edit fails", async () => {
		process.env.THESYS_API_KEY = "env-key";
		cloudService({
			create: async () => cloudCreated("art_keep"),
			edit: async () => {
				throw new Error("provider rejected the edit");
			},
		});
		await settleDashboardMessage("session-1", "message-1", message({ prompt: "orders" }));
		const edited = await settleDashboardMessage(
			"session-1",
			"message-2",
			message({ id: "art_keep", prompt: "add a filter" }),
		);
		expect(edited?.output).toMatchObject({
			response: cloudCreated("art_keep"),
			error: expect.stringContaining("provider rejected"),
		});
	});

	it("records a cloud create failure without substituting a board", async () => {
		process.env.THESYS_API_KEY = "env-key";
		cloudService({
			create: async () => {
				throw new Error("Organization billing suspended due to threshold limit.");
			},
		});
		const stored = await settleDashboardMessage("session-1", "message-1", message({ prompt: "orders" }));
		expect((stored?.output as { response?: string; error?: string }).response).toBeUndefined();
		expect((stored?.output as { error?: string }).error).toContain("billing suspended");
	});

	it("redacts credentials from a cloud error", async () => {
		process.env.THESYS_API_KEY = "env-key";
		cloudService({
			create: async () => {
				throw new Error("bad key sk-live-abcdef123456 rejected");
			},
		});
		const stored = await settleDashboardMessage("session-1", "message-1", message({ prompt: "orders" }));
		expect(JSON.stringify(stored)).not.toContain("sk-live-abcdef123456");
	});

	it("keeps a built board when the same create fence is repeated without a key", async () => {
		process.env.THESYS_API_KEY = "env-key";
		cloudService();
		const content = message({ title: "Orders", prompt: "orders" });
		const created = await settleDashboardMessage("session-1", "message-1", content);
		delete process.env.THESYS_API_KEY;
		const repeated = await settleDashboardMessage("session-1", "message-2", content);
		expect(repeated?.id).toBe(created?.id);
		expect(repeated?.output).toMatchObject({ response: cloudCreated("art_test") });
		expect(repeated?.output).not.toHaveProperty("error");
	});

	it("creates one cloud board when the same fence settles twice at once", async () => {
		process.env.THESYS_API_KEY = "env-key";
		let calls = 0;
		let release = (): void => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		cloudService({
			create: async () => {
				calls += 1;
				await gate;
				return cloudCreated("art_once");
			},
		});
		const content = message({ prompt: "orders" });
		const first = settleDashboardMessage("session-1", "message-1", content);
		await vi.waitFor(() => expect(calls).toBe(1));
		const second = settleDashboardMessage("session-1", "message-2", content);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls).toBe(1);
		release();
		const [created, again] = await Promise.all([first, second]);
		expect(calls).toBe(1);
		expect(again?.id).toBe(created?.id);
		expect(again?.output).toMatchObject({ response: cloudCreated("art_once") });
	});

	it("keeps stored rows when an edit repeats columns without rows", async () => {
		process.env.THESYS_API_KEY = "env-key";
		cloudService();
		const columns = [{ key: "seats", label: "Seats", type: "number" }];
		await settleDashboardMessage(
			"session-1",
			"message-1",
			message({ prompt: "orders", columns, rows: [{ seats: 250 }] }),
		);
		const edited = await settleDashboardMessage(
			"session-1",
			"message-2",
			message({ id: "art_test", prompt: "add a filter", columns }),
		);
		expect(edited?.output).toMatchObject({ dataset: { rows: [{ seats: 250 }] } });
	});

	it("returns 400 when the interpreter body is not JSON", async () => {
		const response = await handleDashboardsInterpreterPost(
			new Request("http://127.0.0.1/api/chat/dashboards/interpreter?sessionId=session-1", {
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1" },
				body: "{",
			}),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
	});

	it("keeps a cloud board when the key is removed", async () => {
		process.env.THESYS_API_KEY = "env-key";
		cloudService();
		await settleDashboardMessage("session-1", "message-1", message({ title: "Orders", prompt: "orders" }));
		delete process.env.THESYS_API_KEY;
		const edited = await settleDashboardMessage(
			"session-1",
			"message-2",
			message({ id: "art_test", prompt: "add a filter" }),
		);
		expect(edited?.output).toMatchObject({
			response: cloudCreated("art_test"),
			error: expect.stringContaining("Thesys"),
		});
	});

	it("retries an edit that arrives while the dashboard is still generating", async () => {
		process.env.THESYS_API_KEY = "env-key";
		let attempts = 0;
		cloudService({
			create: async () => cloudCreated("art_race"),
			edit: async ({ id }) => {
				attempts += 1;
				if (attempts < 3) throw Object.assign(new Error("still generating"), { status: 409 });
				return `edited ${id}`;
			},
		});
		const created = await settleDashboardMessage("session-1", "message-1", message({ prompt: "orders" }));
		const edited = await settleDashboardMessage(
			"session-1",
			"message-2",
			message({ id: "art_race", prompt: "add a filter" }),
		);
		expect(attempts).toBe(3);
		expect(edited?.id).toBe(created?.id);
		expect(edited?.output).toMatchObject({ response: "edited art_race" });
	});

	it("keeps the previous board when generation never settles", async () => {
		process.env.THESYS_API_KEY = "env-key";
		cloudService({
			create: async () => cloudCreated("art_slow"),
			edit: async () => {
				throw Object.assign(new Error("This dashboard is still generating; edit it once it finishes"), {
					status: 409,
				});
			},
		});
		await settleDashboardMessage("session-1", "message-1", message({ prompt: "orders" }));
		const edited = await settleDashboardMessage(
			"session-1",
			"message-2",
			message({ id: "art_slow", prompt: "add a filter" }),
		);
		expect(edited?.output).toMatchObject({
			response: cloudCreated("art_slow"),
			error: expect.stringContaining("still generating"),
		});
	}, 20_000);

	it("does nothing for an unknown session", async () => {
		process.env.THESYS_API_KEY = "env-key";
		cloudService();
		expect(await settleDashboardMessage("missing", "message-1", message({ prompt: "orders" }))).toBeUndefined();
		expect(storedArtifacts()).toHaveLength(0);
	});
});
