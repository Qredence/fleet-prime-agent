import { library as dashboardLibrary } from "@openuidev/dashboard-library";
import { createParser } from "@openuidev/react-lang";
import { buildOpenUIPrompt } from "@prime-agent/web-protocol";
import { describe, expect, it } from "vitest";
import { openUILibrary } from "@/components/openui/openui-library";

/** Pulls openui-lang programs out of ```openui and ```openui-dashboard fences. */
function extractOpenUIExamples(prompt: string): string[] {
	const programs: string[] = [];
	const fence = /```openui\n([\s\S]*?)```/g;
	for (const match of prompt.matchAll(fence)) {
		const body = match[1]?.trim();
		if (body) programs.push(body);
	}
	const dashboardFence = /```openui-dashboard\n([\s\S]*?)```/g;
	for (const match of prompt.matchAll(dashboardFence)) {
		try {
			const parsed = JSON.parse(match[1] ?? "") as { program?: unknown };
			if (typeof parsed.program === "string" && parsed.program.trim()) programs.push(parsed.program.trim());
		} catch {
			// A prompt fence has no program. The local example is the one this parses.
		}
	}
	return programs;
}

/**
 * Identifiers assigned to Tabs or Steps. A prompt example that declares one of
 * these and never places it under root teaches the model to skip the component.
 */
function declaredContainerIds(program: string): string[] {
	const ids: string[] = [];
	for (const name of ["Tabs", "Steps"] as const) {
		const pattern = new RegExp(`^\\s*([A-Za-z_$][\\w$]*)\\s*=\\s*${name}\\(`, "gm");
		for (const match of program.matchAll(pattern)) {
			const id = match[1];
			if (id) ids.push(id);
		}
	}
	return ids;
}

/** True when `id` appears somewhere other than its own assignment line. */
function isReferencedOutsideAssignment(program: string, id: string): boolean {
	const withoutOwnAssignment = program
		.split("\n")
		.filter((line) => !new RegExp(`^\\s*${id}\\s*=`).test(line))
		.join("\n");
	return new RegExp(`\\b${id}\\b`).test(withoutOwnAssignment);
}

describe("OpenUI agent prompt examples", () => {
	const prompt = buildOpenUIPrompt("agent", { syntaxVersion: "1.x" });
	const programs = extractOpenUIExamples(prompt);
	const parser = createParser(openUILibrary.toJSONSchema(), openUILibrary.root);
	// Dashboard programs render with the dashboard library, so they validate
	// against it rather than the chat catalog.
	const dashboardParser = createParser(dashboardLibrary.toJSONSchema(), dashboardLibrary.root);

	it("keeps tool examples root-first", () => {
		for (const program of programs.filter((value) => value.includes('Query("'))) {
			const isDashboardProgram = program.startsWith("root = Dashboard(");
			expect(program.split("\n")[0]).toMatch(isDashboardProgram ? /^root = Dashboard/ : /^root = Root/);
		}
	});
	it("defaults undeclared clients to the legacy catalog and wrapped actions", () => {
		const legacy = buildOpenUIPrompt("agent");
		expect(legacy).toBe(buildOpenUIPrompt("agent", { syntaxVersion: "0.x" }));
		expect(legacy).toContain('Button("Apply Filters", Action([');
		expect(legacy).not.toContain("@OpenPanel");
		expect(legacy).not.toContain("Tabs(");
		expect(legacy).not.toContain('Query("list_sessions"');
		expect(prompt).toContain('Query("list_sessions"');
	});
	it("ships at least one fenced openui example", () => {
		expect(programs.length).toBeGreaterThan(0);
	});

	it("does not teach a Mutation section after the read-only strip", () => {
		expect(prompt).not.toMatch(/## Mutation/);
		expect(prompt).not.toMatch(/^\s*\w+\s*=\s*Mutation\(/m);
		expect(prompt).not.toMatch(/form \+ mutation patterns/i);
	});

	it("parses every fenced openui example without hard errors", () => {
		for (const program of programs) {
			const active = program.startsWith("root = Dashboard(") ? dashboardParser : parser;
			const result = active.parse(program);
			const hardErrors = result.meta.errors.filter((error) => error.severity !== "warning");
			expect(hardErrors, program).toEqual([]);
		}
	});

	it("places every declared Tabs or Steps statement under the rendered tree", () => {
		for (const program of programs) {
			for (const id of declaredContainerIds(program)) {
				expect(
					isReferencedOutsideAssignment(program, id),
					`${id} is declared but never rendered:\n${program}`,
				).toBe(true);
			}
		}
	});

	it("teaches a local program and a cloud prompt, both bound to this session", () => {
		const local = buildOpenUIPrompt("agent", { syntaxVersion: "1.x", dashboards: { mode: "self-hosted" } });
		const cloud = buildOpenUIPrompt("agent", {
			syntaxVersion: "1.x",
			dashboards: { mode: "cloud", latestDashboardId: "art_1" },
		});
		const localPrograms = extractOpenUIExamples(local).filter((program) => program.startsWith("root = Dashboard("));
		expect(localPrograms.length).toBeGreaterThan(0);
		for (const program of localPrograms) {
			const result = dashboardParser.parse(program);
			expect(
				result.meta.errors.filter((error) => error.severity !== "warning"),
				program,
			).toEqual([]);
		}
		const localWithId = buildOpenUIPrompt("agent", {
			syntaxVersion: "1.x",
			dashboards: { mode: "self-hosted", latestDashboardId: "dash_local" },
		});
		expect(localWithId).toContain("dash_local");
		expect(local).toContain('Query("session_outputs"');
		expect(local).toContain('Query("dashboard_rows")');
		expect(local).toContain("normal tools");
		expect(local).not.toContain("dashboard_dataset");
		expect(cloud).toContain("art_1");
		expect(cloud).toContain('"prompt"');
		expect(cloud).toContain("dashboard_rows");
		expect(cloud).toContain("normal tools");
		expect(cloud).not.toContain("root = Dashboard(");
		expect(cloud).not.toContain("dashboard_dataset");
	});

	it("aggregates session_stats by sessions, not by counting status rows", () => {
		const statsExamples = programs.filter((program) => program.includes('Query("session_stats"'));
		expect(statsExamples.length).toBeGreaterThan(0);
		for (const program of statsExamples) {
			expect(program).not.toMatch(/@Count\(@Filter\(stats\.rows/);
			expect(program).not.toMatch(/@Count\(stats\.rows\)/);
		}
	});
});
