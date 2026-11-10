import {
	DASHBOARD_MODEL_SUGGESTIONS,
	DashboardRecordSchema,
	DEFAULT_DASHBOARD_MODEL,
	dashboardFenceKey,
	dashboardFences,
	dashboardIdFromResponse,
	stripDashboardFences,
} from "@prime-agent/web-protocol/dashboards";
import { describe, expect, it } from "vitest";

describe("dashboard contract", () => {
	it("reads one completed fence and skips a fence that is still streaming", () => {
		const complete = 'Intro\n```openui-dashboard\n{"title":"Orders","prompt":"daily orders"}\n```\nOutro';
		expect(dashboardFences(complete)).toEqual([{ title: "Orders", prompt: "daily orders" }]);
		expect(dashboardFences('```openui-dashboard\n{"prompt":"partial"')).toEqual([]);
		expect(dashboardFences("```openui-dashboard\nnot json\n```")).toEqual([]);
	});

	it("keeps backticks that sit inside a JSON string", () => {
		const fenced = [
			"Intro",
			"```openui-dashboard",
			JSON.stringify({ title: "Orders", prompt: 'include ``` and she said "tick"' }),
			"```",
			"Outro",
			"```openui-dashboard",
			'{"prompt":"daily"}```',
		].join("\n");
		expect(dashboardFences(fenced)).toEqual([
			{ title: "Orders", prompt: 'include ``` and she said "tick"' },
			{ prompt: "daily" },
		]);
		expect(stripDashboardFences(fenced)).toBe("Intro\n\nOutro");
	});

	it("accepts a program fence and a cloud edit fence", () => {
		const [program] = dashboardFences(
			'```openui-dashboard\n{"title":"Orders","program":"root = Dashboard([])"}\n```',
		);
		expect(program).toEqual({ title: "Orders", program: "root = Dashboard([])" });
		const [edit] = dashboardFences('```openui-dashboard\n{"id":"art_123","prompt":"add a table"}\n```');
		expect(edit).toEqual({ id: "art_123", prompt: "add a table" });
	});

	it("drops a fence that carries neither a prompt nor a program", () => {
		expect(dashboardFences('```openui-dashboard\n{"title":"Orders"}\n```')).toEqual([]);
		expect(
			dashboardFences('```openui-dashboard\n{"title":"Orders","data":{"description":"rows","rows":[{}]}}\n```'),
		).toEqual([]);
	});

	it("coerces OpenUI column type aliases so text columns still settle", () => {
		const [fence] = dashboardFences(
			`\`\`\`openui-dashboard\n${JSON.stringify({
				title: "Repo",
				prompt: "snapshot",
				columns: [
					{ key: "section", label: "Section", type: "text" },
					{ key: "spend", label: "Spend", type: "currency" },
					{ key: "share", label: "Share", type: "percent" },
				],
				rows: [{ section: "Stars", spend: 54, share: 12 }],
			})}\n\`\`\``,
		);
		expect(fence?.dataset?.columns).toEqual([
			{ key: "section", label: "Section", type: "string" },
			{ key: "spend", label: "Spend", type: "number" },
			{ key: "share", label: "Share", type: "number" },
		]);
		expect(fence?.dataset?.rows).toEqual([{ section: "Stars", spend: 54, share: 12 }]);
	});

	it("reads a padded row key as the trimmed column", () => {
		const [fence] = dashboardFences(
			`\`\`\`openui-dashboard\n${JSON.stringify({
				prompt: "seats",
				columns: [{ key: " seats ", label: "Seats", type: "number" }],
				rows: [{ " seats ": 250 }],
			})}\n\`\`\``,
		);
		expect(fence?.dataset?.rows).toEqual([{ seats: 250 }]);
	});

	it("omits the dataset when columns are repeated without rows", () => {
		const [fence] = dashboardFences(
			`\`\`\`openui-dashboard\n${JSON.stringify({
				id: "art_1",
				prompt: "add a filter",
				columns: [{ key: "seats", label: "Seats", type: "number" }],
			})}\n\`\`\``,
		);
		expect(fence).toMatchObject({ id: "art_1", prompt: "add a filter" });
		expect(fence?.dataset).toBeUndefined();
	});

	it("defaults an omitted column type to string so label columns still settle", () => {
		const [fence] = dashboardFences(
			`\`\`\`openui-dashboard\n${JSON.stringify({
				title: "Repo",
				prompt: "snapshot",
				columns: [
					{ key: "section", label: "Section" },
					{ key: "value", label: "Value", type: "number" },
				],
				rows: [{ section: "Stars", value: 54 }],
			})}\n\`\`\``,
		);
		expect(fence?.dataset?.columns).toEqual([
			{ key: "section", label: "Section", type: "string" },
			{ key: "value", label: "Value", type: "number" },
		]);
		expect(fence?.dataset?.rows).toEqual([{ section: "Stars", value: 54 }]);
	});

	it("accepts stated rows, caps string cells, and rejects a non-numeric number cell", () => {
		const long = "x".repeat(600);
		const [fence] = dashboardFences(
			`\`\`\`openui-dashboard\n${JSON.stringify({
				title: "Midterms",
				prompt: "House seats",
				columns: [
					{ key: "party", label: "Party", type: "string" },
					{ key: "seats", label: "Seats", type: "number" },
				],
				rows: [{ party: long, seats: 250 }],
			})}\n\`\`\``,
		);
		expect(fence?.dataset?.rows).toEqual([{ party: "x".repeat(500), seats: 250 }]);
		expect(
			dashboardFences(
				`\`\`\`openui-dashboard\n${JSON.stringify({
					prompt: "House seats",
					columns: [{ key: "seats", label: "Seats", type: "number" }],
					rows: [{ seats: "250" }],
				})}\n\`\`\``,
			),
		).toEqual([]);
		const tooMany = Array.from({ length: 201 }, () => ({ seats: 1 }));
		expect(
			dashboardFences(
				`\`\`\`openui-dashboard\n${JSON.stringify({
					prompt: "House seats",
					columns: [{ key: "seats", label: "Seats", type: "number" }],
					rows: tooMany,
				})}\n\`\`\``,
			),
		).toEqual([]);
	});

	it("keeps the same fence key for the same fence text", () => {
		const [fence] = dashboardFences('```openui-dashboard\n{"title":"Orders","prompt":"daily orders"}\n```');
		expect(fence).toBeDefined();
		expect(dashboardFenceKey(fence!)).toBe(dashboardFenceKey({ title: "Orders", prompt: "daily orders" }));
		expect(dashboardFenceKey(fence!)).not.toBe(dashboardFenceKey({ title: "Orders", prompt: "weekly orders" }));
		const withRows = dashboardFenceKey({
			title: "Orders",
			prompt: "daily orders",
			dataset: {
				columns: [{ key: "seats", label: "Seats", type: "number" }],
				rows: [{ seats: 250 }],
			},
		});
		expect(withRows).not.toBe(dashboardFenceKey({ title: "Orders", prompt: "daily orders" }));
	});

	it("extracts a cloud id and leaves the rest of the response opaque", () => {
		expect(dashboardIdFromResponse("]]>openui:content?artifact_id=art_-_VZTnJTms6Ls8EgHlRDO&type=dashboard")).toBe(
			"art_-_VZTnJTms6Ls8EgHlRDO",
		);
		expect(dashboardIdFromResponse("see art_decoy then ]]>openui:content?artifact_id=art_real&type=dashboard")).toBe(
			"art_real",
		);
		expect(dashboardIdFromResponse("the id is art_only")).toBeUndefined();
	});

	it("suggests catalog ids and the default model", () => {
		expect(DASHBOARD_MODEL_SUGGESTIONS).toEqual([
			"anthropic/claude-sonnet-5.5",
			"openai/gpt-6-luna",
			"openai/gpt-6-sol",
			"google/gemini-4-argon",
		]);
		expect(DASHBOARD_MODEL_SUGGESTIONS).toContain(DEFAULT_DASHBOARD_MODEL);
		for (const model of DASHBOARD_MODEL_SUGGESTIONS) expect(model).toContain("/");
	});

	it("stores a cloud response and rejects a program record", () => {
		expect(
			DashboardRecordSchema.safeParse({
				mode: "cloud",
				response: "opaque",
				dashboardId: "art_1",
				fenceKey: "abcdef01",
			}).success,
		).toBe(true);
		expect(DashboardRecordSchema.safeParse({ mode: "self-hosted", program: "root = Dashboard([])" }).success).toBe(
			false,
		);
		expect(
			DashboardRecordSchema.safeParse({
				mode: "local",
				program: "root = Dashboard([])",
				fenceKey: "abcdef01",
			}).success,
		).toBe(true);
	});
});
