import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getMessages: vi.fn(async () => [] as unknown[]),
	definitions: [] as Array<{
		tools: Record<string, DataTool>;
		promptOptions?: { preamble?: string; additionalRules?: string[]; examples?: string[] };
	}>,
}));

/** A `DataTool` is a definition object; `execute` is the part the interpreter runs. */
type DataTool = {
	description: string;
	parameters: unknown;
	output: unknown;
	execute: (args: unknown, context: unknown, opts: { signal?: AbortSignal }) => Promise<unknown>;
};

vi.mock("../prime-config", () => ({
	getPrimeConfig: () => ({ agentDir: "/tmp/fleet-test", reloadAuth: vi.fn() }),
}));

vi.mock("../handlers/session-access", async () => {
	const { getBridge } = await import("../singleton");
	return {
		requireProjectSession: async () => true,
		requireSession: async (sessionId: string) =>
			getBridge().getSession(sessionId) ?? (await getBridge().resumeSessionById(sessionId)),
	};
});

vi.mock("../singleton", () => ({
	getBridge: () => ({
		getSession: () => ({ sessionId: "session-1", projectId: "project-1" }),
		resumeSessionById: async () => undefined,
		getMessages: mocks.getMessages,
	}),
}));

vi.mock("@openuidev/server", () => {
	class OpenUIApiError extends Error {
		code = "openui_error";
		status = 502;
	}
	class ToolExecutionError extends Error {
		code: string;
		status: number;
		constructor(message: string, code: string, status: number) {
			super(message);
			this.code = code;
			this.status = status;
		}
	}
	class OpenUIClient {
		defineDashboard(options: {
			tools: Record<string, DataTool>;
			promptOptions?: { preamble?: string; additionalRules?: string[]; examples?: string[] };
		}) {
			mocks.definitions.push(options);
			return {
				create: async () => "created",
				edit: async () => "edited",
				interpreter: { execute: async () => ({ rows: [] }) },
			};
		}
		createFrontendToken() {
			return { token: "fct_test", expires_at: 1 };
		}
	}
	return { OpenUIClient, ToolExecutionError, OpenUIApiError };
});

import { createDashboardService } from "../dashboards/cloud";

function sessionOutputsTool(): DataTool["execute"] {
	createDashboardService("sk-test");
	const tool = mocks.definitions.at(-1)?.tools.session_outputs;
	if (!tool) throw new Error("session_outputs tool is missing from the dashboard definition.");
	return tool.execute;
}

/**
 * The interpreter route passes the request signal so a dashboard that closes or
 * times out stops fetching session messages.
 */
describe("session_outputs abort handling", () => {
	it("does not read messages when the request already aborted", async () => {
		mocks.getMessages.mockClear();
		const controller = new AbortController();
		controller.abort();

		await expect(
			sessionOutputsTool()(
				{ limit: 20 },
				{ userId: "user-1", sessionId: "session-1" },
				{ signal: controller.signal },
			),
		).rejects.toThrow();
		expect(mocks.getMessages).not.toHaveBeenCalled();
	});

	it("reads messages when the request is still live", async () => {
		mocks.getMessages.mockClear();
		const result = await sessionOutputsTool()(
			{ limit: 20 },
			{ userId: "user-1", sessionId: "session-1" },
			{ signal: new AbortController().signal },
		);
		expect(mocks.getMessages).toHaveBeenCalledWith("session-1");
		expect(result).toMatchObject({ rows: [] });
	});

	/**
	 * `Table([Col(...)])` takes one primitive array per column and openui-lang
	 * has no projection builtin, so the tool returns the projection itself.
	 * Without it a dashboard renders a header over blank cells.
	 */
	it("serves stated figures from dashboard_rows and drops placeholder data", async () => {
		createDashboardService("sk-test");
		const definition = mocks.definitions.at(-1);
		expect(definition?.promptOptions?.additionalRules?.join("\n")).not.toMatch(/placeholder data/i);
		const examples = definition?.promptOptions?.examples?.join("\n") ?? "";
		expect(examples).toContain('Query("dashboard_rows"');
		expect(examples).not.toMatch(/\d|\$/);
		expect(definition?.promptOptions?.preamble).toMatch(/Lay out the figures Prime Agent already collected/);
		const rules = definition?.promptOptions?.additionalRules?.join("\n");
		expect(rules).toMatch(/Do not research/);
		expect(rules).toMatch(/label and value stand in for column keys/);
		const result = await definition?.tools.dashboard_rows?.execute(
			{},
			{
				userId: "user-1",
				sessionId: "session-1",
				dataset: {
					columns: [{ key: "seats", label: "Seats", type: "number" }],
					rows: [{ seats: 250 }],
				},
			},
			{ signal: new AbortController().signal },
		);
		expect(result).toMatchObject({ columnValues: { seats: [250] }, rows: [{ seats: 250 }] });
		mocks.getMessages.mockClear();
		const hidden = await definition?.tools.session_outputs?.execute(
			{ limit: 20 },
			{
				userId: "user-1",
				sessionId: "session-1",
				dataset: {
					columns: [{ key: "seats", label: "Seats", type: "number" }],
					rows: [{ seats: 250 }],
				},
			},
			{ signal: new AbortController().signal },
		);
		expect(hidden).toMatchObject({ rows: [], total: 0, toolCalls: 0 });
		expect(mocks.getMessages).not.toHaveBeenCalled();
	});

	it("projects rows into per-column arrays", async () => {
		mocks.getMessages.mockResolvedValueOnce([
			{
				role: "assistant",
				parts: [
					{ type: "text", text: "Read the file" },
					{ type: "tool-read", toolName: "read", output: { path: "src/main.ts" } },
				],
			},
		] satisfies unknown[]);

		const result = (await sessionOutputsTool()(
			{ limit: 20 },
			{ userId: "user-1", sessionId: "session-1" },
			{ signal: new AbortController().signal },
		)) as {
			rows: Array<{ turn: number; role: string; kind: string }>;
			columns: Record<string, unknown[]>;
			total: number;
			toolCalls: number;
		};

		expect(result.rows.length).toBe(2);
		expect(result.total).toBe(2);
		expect(result.toolCalls).toBe(1);
		// Every column must be as long as the rows, or the table misaligns.
		for (const [field, values] of Object.entries(result.columns)) {
			expect(values, `${field} column length`).toHaveLength(result.rows.length);
		}
		expect(result.columns.turn).toEqual([1, 1]);
		expect(result.columns.role).toEqual(["assistant", "assistant"]);
		expect(result.columns.kind).toEqual(["text", "tool"]);
		expect(result.columns.toolName).toEqual(["", "read"]);
		expect(result.columns.preview?.[0]).toBe("Read the file");
	});

	it("slices columns to the same page as rows", async () => {
		mocks.getMessages.mockResolvedValueOnce([
			{ role: "assistant", parts: [{ type: "text", text: "one" }] },
			{ role: "assistant", parts: [{ type: "text", text: "two" }] },
			{ role: "assistant", parts: [{ type: "text", text: "three" }] },
		] satisfies unknown[]);

		const result = (await sessionOutputsTool()(
			{ limit: 2 },
			{ userId: "user-1", sessionId: "session-1" },
			{ signal: new AbortController().signal },
		)) as { rows: unknown[]; columns: Record<string, unknown[]>; total: number };

		expect(result.rows).toHaveLength(2);
		// The KPI still reports the session total, not the page size.
		expect(result.total).toBe(3);
		expect(result.columns.turn).toEqual([1, 2]);
	});
});
