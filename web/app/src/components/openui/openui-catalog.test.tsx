import { Renderer } from "@openuidev/react-lang";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openUILibrary } from "@/components/openui/openui-library";

function renderProgram(response: string) {
	return render(<Renderer library={openUILibrary} response={response} />);
}

describe("OpenUI catalog rendering", () => {
	it("renders Tabs with the selected panel and mounts other panels on demand", async () => {
		renderProgram(
			'root = Root([t])\nt = Tabs([{"label":"Overview","content":"overview body"},{"label":"Recent","content":"recent body"}], 0)',
		);
		expect(await screen.findByRole("tab", { name: "Overview" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Recent" })).toBeTruthy();
		expect(screen.getByText("overview body")).toBeTruthy();
	});

	it("renders Steps states", async () => {
		renderProgram(
			'root = Root([s])\ns = Steps([{"label":"Query","state":"complete"},{"label":"Render","state":"current","detail":"streaming"}])',
		);
		expect(await screen.findByText("Query")).toBeTruthy();
		expect(screen.getByText("streaming")).toBeTruthy();
	});

	it("renders a query-backed table from the tool provider", async () => {
		render(
			<Renderer
				library={openUILibrary}
				response={
					'root = Root([t])\nd = Query("list_sessions", {}, {rows: []})\nt = DataTable("Runs", [{"key":"title","label":"Session"},{"key":"messageCount","label":"Messages","type":"number"}], d.rows)'
				}
				toolProvider={{
					list_sessions: async () => ({
						rows: [{ title: "Alpha session", messageCount: 12 }],
					}),
				}}
			/>,
		);
		expect(await screen.findByText("Alpha session")).toBeTruthy();
		expect(screen.getByText("12")).toBeTruthy();
	});

	it("evaluates client functions inside a prop", async () => {
		renderProgram('root = Root([t])\nt = Text("dur " + @Duration(5400000))');
		expect(await screen.findByText("dur 1.5h")).toBeTruthy();
	});

	it("shows a placeholder for a column key the rows do not carry", async () => {
		renderProgram('root = Root([t])\nt = DataTable("T", [{"key":"absent","label":"Absent"}], [{"present":"x"}])');
		expect(await screen.findByText("—")).toBeTruthy();
	});
});
