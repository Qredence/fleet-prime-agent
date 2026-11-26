import type { DashboardRecord } from "@prime-agent/web-protocol/dashboards";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardBoard } from "@/components/dashboards/dashboard-board";

const legacyProgram = `root = Dashboard([header, section])
header = DashboardHeader("Saved dashboard")
section = Section([tableCard], null, "Activity")
tableCard = LargeCard([table], false)
table = Table([Col("Turn", [1], "number"), Col("Role", ["assistant"])])`;

function renderBoard(output: DashboardRecord) {
	return render(
		<DashboardBoard
			artifact={{
				id: "saved-dashboard",
				runId: "dashboard-run",
				kind: "openui-dashboard",
				title: "Saved dashboard",
				status: "success",
				output,
				timestamp: 1,
			}}
		/>,
	);
}

function renderProgram(program: string) {
	return renderBoard({ mode: "local", program, fenceKey: "saved" });
}

function tableRows(container: HTMLElement): string[][] {
	return [...container.querySelectorAll("tr")].map((row) =>
		[...row.querySelectorAll("th,td")].map((cell) => cell.textContent?.trim() ?? ""),
	);
}

describe("local dashboard rendering", () => {
	it("reopens a saved dashboard from the previous component library", async () => {
		const { container } = renderProgram(legacyProgram);
		await screen.findByText("assistant");
		expect(tableRows(container)).toEqual([
			["Turn", "Role"],
			["1", "assistant"],
		]);
	});

	it("renders cell values from the columns the tool returns", () => {
		const program = `root = Dashboard([activity])
outputs = {rows: [], columns: {turn: [1, 2], role: ["assistant", "user"], preview: ["Read src/main.ts", "Summarize the diff"]}, total: 2}
activity = Section("This session", [Row([Card("Session outputs", [Table([Column("Turn", outputs.columns.turn, "number"), Column("Role", outputs.columns.role, "text"), Column("Preview", outputs.columns.preview, "text")])], "full", "Oldest first")])])`;

		expect(tableRows(renderProgram(program).container)).toEqual([
			["Turn", "Role", "Preview"],
			["1", "assistant", "Read src/main.ts"],
			["2", "user", "Summarize the diff"],
		]);
	});

	/** The regression: whole row objects render as text, not as a field of each row. */
	it("stringifies row objects when a column receives rows", () => {
		const program = `root = Dashboard([activity])
outputs = {rows: [{turn: 1, role: "assistant"}, {turn: 2, role: "user"}]}
activity = Section("This session", [Row([Card("Session outputs", [Table([Column("Turn", outputs.rows, "number"), Column("Role", outputs.rows, "text")])], "full", "Oldest first")])])`;

		expect(tableRows(renderProgram(program).container)).toEqual([
			["Turn", "Role"],
			["[object Object]", "[object Object]"],
			["[object Object]", "[object Object]"],
		]);
	});
});

describe("cloud dashboard rendering", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("reopens the previous component library from an opaque Cloud response", async () => {
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const url = new URL(input instanceof Request ? input.url : input, "http://localhost");
			if (url.pathname === "/api/chat/dashboards/token") {
				return Response.json({ token: "fct_test", expires_at: 4_000_000_000 });
			}
			if (url.pathname === "/v1/artifacts/art_saved/stream") {
				return new Response(
					`event: reference\ndata: {"version":"1"}\n\nevent: delta\ndata: ${JSON.stringify({ text: legacyProgram })}\n\nevent: end\ndata: {}\n\n`,
					{ headers: { "content-type": "text/event-stream" } },
				);
			}
			throw new Error(`Unexpected dashboard request: ${url.pathname}`);
		});
		vi.stubGlobal("fetch", fetch);

		const { container } = renderBoard({
			mode: "cloud",
			response: "]]>openui:content?artifact_id=art_saved&type=dashboard&name=Saved&version=1",
			fenceKey: "saved",
		});

		await screen.findByText("assistant");
		expect(tableRows(container)).toEqual([
			["Turn", "Role"],
			["1", "assistant"],
		]);
		expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/art_saved/stream"))).toHaveLength(1);
	});
});
