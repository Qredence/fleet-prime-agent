import { Renderer } from "@openuidev/react-lang";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccordionDef, KeyValueListDef, StepsDef, TabsDef } from "@/components/openui/openui-extra-components";
import { openUILibrary } from "@/components/openui/openui-library";
import { readStoredState, writeStoredState } from "@/components/openui/openui-state-store";

function renderProgram(response: string) {
	return render(<Renderer library={openUILibrary} response={response} />);
}

describe("OpenUI catalog rendering", () => {
	it("filters non-object query rows before rendering and sorting", async () => {
		renderProgram(
			'root = Root([DataTable("Mixed", [{key: "name", label: "Name"}], [null, 3, "invalid", [], {name: "Zebra"}, {name: "Alpha"}])])',
		);
		expect(await screen.findByText("Zebra")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Name/ }));
		expect(
			screen
				.getAllByRole("row")
				.slice(1)
				.map((row) => row.textContent),
		).toEqual(["Alpha", "Zebra"]);
	});
	it("shows the empty state when all rows are invalid", async () => {
		renderProgram('root = Root([DataTable("Empty", [{key: "name", label: "Name"}], [null, 3])])');
		expect(await screen.findByText(/No data/)).toBeTruthy();
	});
	it("persists ordinary renderer input while excluding password input", async () => {
		const program =
			'$pwd = ""\n$q = ""\nroot = Root([Input("Password", $pwd, null, "password"), Input("Query", $q)])';
		window.localStorage.clear();
		render(
			<Renderer
				library={openUILibrary}
				response={program}
				onStateUpdate={(state) => writeStoredState("session", "block", program, state)}
			/>,
		);
		fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "secret" } });
		fireEvent.change(screen.getByLabelText("Query"), { target: { value: "hello" } });
		await waitFor(() => expect(readStoredState("session", "block", program)).toMatchObject({ $q: "hello" }));
		expect(window.localStorage.getItem("fleet.openui.state.v2:session:block")).not.toContain("secret");
	});
	it("ignores null list entries during partial rendering", () => {
		const Tabs = TabsDef.component;
		const Accordion = AccordionDef.component;
		const Steps = StepsDef.component;
		const KeyValueList = KeyValueListDef.component;
		const tabs = [null, { label: "Tab", content: "Body" }, undefined] as unknown as Array<{
			label: string;
			content?: unknown;
		}>;
		const sections = [undefined, { title: "Section", content: "Details" }, null] as unknown as Array<{
			title: string;
			content?: unknown;
		}>;
		const steps = [null, { label: "Step", state: "pending" }, undefined] as unknown as Array<{
			label: string;
			state: "pending";
		}>;
		const pairs = [undefined, { label: "Key", value: "Value" }, null] as unknown as Array<{
			label: string;
			value: string;
		}>;
		const renderNode = (value: unknown) => String(value ?? "");
		render(
			<>
				<Tabs props={{ tabs }} renderNode={renderNode} />
				<Accordion props={{ items: sections }} renderNode={renderNode} />
				<Steps props={{ steps }} renderNode={renderNode} />
				<KeyValueList props={{ items: pairs }} renderNode={renderNode} />
			</>,
		);
		expect(screen.getByRole("tab", { name: "Tab" })).toBeTruthy();
		for (const label of ["Section", "Step", "Key", "Value"]) expect(screen.getByText(label)).toBeTruthy();
	});
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
			'root = Root([s])\ns = Steps([{"label":"Query","state":"complete"},{"label":"Render","state":"current","detail":"streaming"},{"label":"Wait"},{"label":"Fail","state":"failed"}])',
		);
		expect(await screen.findByText("Query")).toBeTruthy();
		expect(screen.getByText("streaming")).toBeTruthy();
		for (const state of ["Complete", "Current", "Pending", "Failed"]) {
			expect(screen.getByText(`${state}:`, { exact: false }).className).toBe("sr-only");
		}
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

	it("rounds fractional percent precision and clamps it", async () => {
		renderProgram("root = Root([Text(@Percent(1, 3, 1.6)), Text(@Percent(1, 3, -1)), Text(@Percent(1, 3, 9))])");
		expect(await screen.findByText("33.33%")).toBeTruthy();
		expect(screen.getByText("33%")).toBeTruthy();
		expect(screen.getByText("33.333%")).toBeTruthy();
	});

	it("shows a placeholder for a column key the rows do not carry", async () => {
		renderProgram('root = Root([t])\nt = DataTable("T", [{"key":"absent","label":"Absent"}], [{"present":"x"}])');
		expect(await screen.findByText("—")).toBeTruthy();
	});
});
