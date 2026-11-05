import { createParser } from "@openuidev/react-lang";
import { buildOpenUIPrompt } from "@prime-agent/web-protocol";
import { describe, expect, it } from "vitest";
import { openUILibrary } from "@/components/openui/openui-library";

/** Pulls the program body out of every fenced ```openui block in a prompt. */
function extractOpenUIExamples(prompt: string): string[] {
	const programs: string[] = [];
	const fence = /```openui\n([\s\S]*?)```/g;
	for (const match of prompt.matchAll(fence)) {
		const body = match[1]?.trim();
		if (body) programs.push(body);
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

	it("keeps tool examples root-first", () => {
		for (const program of programs.filter((value) => value.includes('Query("')))
			expect(program.split("\n")[0]).toMatch(/^root = Root/);
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
			const result = parser.parse(program);
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

	it("aggregates session_stats by sessions, not by counting status rows", () => {
		const statsExamples = programs.filter((program) => program.includes('Query("session_stats"'));
		expect(statsExamples.length).toBeGreaterThan(0);
		for (const program of statsExamples) {
			expect(program).not.toMatch(/@Count\(@Filter\(stats\.rows/);
			expect(program).not.toMatch(/@Count\(stats\.rows\)/);
		}
	});
});
