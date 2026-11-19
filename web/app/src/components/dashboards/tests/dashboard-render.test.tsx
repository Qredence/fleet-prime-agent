import { library as dashboardLibrary, ThemeProvider } from "@openuidev/dashboard-library";
import { Renderer } from "@openuidev/react-lang";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * A model-written dashboard renders with `@openuidev/dashboard-library`.
 * `Col` takes one primitive array per column. Passing row objects parses
 * cleanly and renders an empty table body.
 */
function renderProgram(program: string) {
	return render(
		<ThemeProvider mode="light">
			<Renderer response={program} library={dashboardLibrary} />
		</ThemeProvider>,
	);
}

function tableRows(container: HTMLElement): string[][] {
	return [...container.querySelectorAll("tr")].map((row) =>
		[...row.querySelectorAll("th,td")].map((cell) => cell.textContent?.trim() ?? ""),
	);
}

describe("local dashboard rendering", () => {
	it("renders cell values from the columns the tool returns", () => {
		const program = `root = Dashboard([header, section])
outputs = {rows: [], columns: {turn: [1, 2], role: ["assistant", "user"], preview: ["Read src/main.ts", "Summarize the diff"]}, total: 2}
header = DashboardHeader("This session")
tableCard = LargeCard([tableHeader, table], false)
tableHeader = DashboardCardHeader("Session outputs", "Oldest first", "text")
table = Table([colTurn, colRole, colPreview])
colTurn = Col("Turn", outputs.columns.turn, "number")
colRole = Col("Role", outputs.columns.role)
colPreview = Col("Preview", outputs.columns.preview)
section = Section([tableCard], null, "Activity")`;

		expect(tableRows(renderProgram(program).container)).toEqual([
			["Turn", "Role", "Preview"],
			["1", "assistant", "Read src/main.ts"],
			["2", "user", "Summarize the diff"],
		]);
	});

	/** The regression: whole row objects render a header with blank cells. */
	it("renders blank cells when a column receives rows", () => {
		const program = `root = Dashboard([header, section])
outputs = {rows: [{turn: 1, role: "assistant"}, {turn: 2, role: "user"}]}
header = DashboardHeader("This session")
tableCard = LargeCard([tableHeader, table], false)
tableHeader = DashboardCardHeader("Session outputs", "Oldest first", "text")
table = Table([colTurn, colRole])
colTurn = Col("Turn", outputs.rows, "number")
colRole = Col("Role", outputs.rows)
section = Section([tableCard], null, "Activity")`;

		expect(tableRows(renderProgram(program).container)).toEqual([
			["Turn", "Role"],
			["", ""],
			["", ""],
		]);
	});
});
