import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionToolRenderer, SpecializedToolRenderer } from "@/components/tools/session-tool-renderer";
import { CodeBlock } from "@/components/tools/tool-code-block";
import { normalizeToolPart } from "@/components/tools/tool-output-normalizer";
import { ToolResultOutput } from "@/components/tools/tool-result";

describe("normalizeToolPart", () => {
	it.each([
		["curl -H 'Authorization: Bearer sample-token' https://example.com", "Bearer", "sample-token"],
		["curl -H 'Authorization: Basic dXNlcjpwYXNz' https://example.com", "Basic", "dXNlcjpwYXNz"],
		["authorization=Bearer sample-token", "Bearer", "sample-token"],
		['authorization="Bearer sample-token"', "Bearer", "sample-token"],
	])("redacts authorization schemes with their credentials in %s", (command, scheme, credential) => {
		const normalized = normalizeToolPart({ type: "tool-Bash", input: { command } });
		expect(normalized?.traceDescription).toContain("[redacted]");
		expect(normalized?.traceDescription).not.toContain(scheme);
		expect(normalized?.traceDescription).not.toContain(credential);
	});
	it.each(["https", "postgresql", "git+https"])("redacts %s URL userinfo and preserves the host", (scheme) => {
		const normalized = normalizeToolPart({
			type: "tool-WebFetch",
			input: { url: `${scheme}://sample-user:sample-pass@example.com/path` },
		});
		expect(normalized?.traceDescription).toBe(`${scheme}://[redacted]@example.com/path`);
	});
	it.each([
		'run --password "hunter two" --verbose',
		"run --password 'hunter two' --verbose",
		'run --password="hunter two" --verbose',
		'run password="hunter two" --verbose',
		'run --token "hunter \\"two\\" three" --verbose',
		'run --secret "hunter two',
	])("redacts the complete quoted credential in %s", (command) => {
		const normalized = normalizeToolPart({ type: "tool-Bash", input: { command } });
		expect(normalized?.traceDescription).toContain("[redacted]");
		expect(normalized?.traceDescription).not.toMatch(/hunter|two|three/);
		if (command.endsWith("--verbose")) expect(normalized?.traceDescription).toContain("--verbose");
	});
	it.each([
		["curl -H 'Authorization: Bearer top-secret' https://example.test", "curl -H 'Authorization: [redacted]'"],
		["fetch https://user:top-secret@example.test/data", "https://[redacted]@example.test/data"],
	])("redacts authorization credentials in trace descriptions: %s", (command, expected) => {
		const normalized = normalizeToolPart({ type: "tool-Bash", input: { command } });
		expect(normalized?.traceDescription).toContain(expected);
		expect(normalized?.traceDescription).not.toContain("top-secret");
	});
	it("renders source and output directly inside a trace without a second tool disclosure", () => {
		const markup = renderToStaticMarkup(
			createElement(SessionToolRenderer, {
				insideTrace: true,
				part: {
					type: "tool-IPython",
					state: "output-available",
					input: { code: "print(1)" },
					output: { details: { stdout: "1" } },
				},
			}),
		);
		expect(markup).not.toContain("aria-expanded");
		expect(markup.match(/data-slot="code-block"/g)).toHaveLength(2);
		expect(markup).toContain("Copy code");
		expect(markup).toContain("Copy result");
	});
	it("provides bounded, redacted trace descriptions and readable durations", () => {
		const bash = normalizeToolPart({
			type: "tool-Bash",
			state: "output-available",
			input: { command: "git status --token=super-secret" },
			output: { stdout: "clean", durationMs: 2_300 },
		});
		expect(bash?.traceDescription).toBe("git status --token=[redacted]");
		expect(bash?.durationLabel).toBe("2.3 s");
		const apiKeyCommand = normalizeToolPart({
			type: "tool-Bash",
			input: { command: "OPENAI_API_KEY=sk-test-secret pnpm run build" },
		});
		expect(apiKeyCommand?.traceDescription).toBe("OPENAI_API_KEY=[redacted] pnpm run build");

		const longInput = normalizeToolPart({
			type: "tool-WebSearch",
			input: { query: "x".repeat(200) },
		});
		expect(longInput?.traceDescription?.length).toBeLessThanOrEqual(96);
	});

	it("extracts nested IPython details and keeps an active unresolved call running", () => {
		const normalized = normalizeToolPart(
			{
				type: "tool-IPython",
				toolCallId: "python-1",
				state: "input-streaming",
				input: { code: "%%bash\nls -la" },
				output: {
					details: {
						durationMs: 22,
						stdout: "ok",
						stderr: "",
						kernelRestarted: true,
					},
					isError: false,
				},
			},
			"streaming",
		);

		expect(normalized?.status).toBe("running");
		expect(normalized?.outputSummary.stdout).toBe("ok");
		expect(normalized?.outputSummary.durationMs).toBe(22);
		expect(normalized?.metadata).toContain("22 ms");
		expect(normalized?.outputSummary.kernelRestarted).toBe(true);
		expect(normalized?.detail).toMatchObject({
			kind: "output",
			content: "stdout\nok",
			structured: false,
			sourceCode: "%%bash\nls -la",
			sourceLanguage: "bash",
			sourceLabel: "IPython",
			sections: [{ label: "stdout", content: "ok", language: "text" }],
		});

		const python = normalizeToolPart({
			type: "tool-IPython",
			state: "output-available",
			input: { code: "value = 1" },
			output: { details: { stdout: "1" } },
		});
		expect(python?.detail).toMatchObject({ sourceLanguage: "python", sourceLabel: "IPython" });
	});

	it("gives terminal states precedence over the global streaming status", () => {
		expect(
			normalizeToolPart(
				{
					type: "tool-Bash",
					state: "output-available",
					output: { stdout: "done" },
				},
				"streaming",
			)?.status,
		).toBe("success");
		expect(normalizeToolPart({ type: "tool-Bash", state: "input-streaming" })?.status).toBe("cancelled");
		expect(normalizeToolPart({ type: "tool-Bash", state: "input-streaming" }, "streaming")?.status).toBe("running");
		expect(
			normalizeToolPart({
				type: "tool-Bash",
				state: "output-error",
				output: { error: "command failed" },
			})?.status,
		).toBe("error");
		expect(normalizeToolPart({ type: "tool-Bash", output: { isError: true, stdout: "failed" } })).toMatchObject({
			status: "success",
			outputSummary: { isError: true },
		});
		const reportedError = normalizeToolPart({
			type: "tool-Bash",
			state: "output-available",
			output: { error: "command failed" },
		});
		expect(reportedError).toMatchObject({
			status: "success",
			detail: { kind: "output", sections: [{ label: "reported-error" }] },
		});
		const errorWithoutMessage = normalizeToolPart({
			type: "tool-Bash",
			state: "output-available",
			output: { isError: true },
		});
		expect(errorWithoutMessage).toMatchObject({
			status: "success",
			detail: { kind: "output", sections: [{ label: "reported-error", content: "The tool reported an error." }] },
		});
		expect(normalizeToolPart({ type: "tool-Bash", state: "aborted" })?.status).toBe("cancelled");
	});

	it("maps structured results, diffs, todos, approvals, images, and citations", () => {
		const json = normalizeToolPart({
			type: "tool-InspectJson",
			state: "output-available",
			result: { version: 2, enabled: true },
		});
		expect(json?.detail).toMatchObject({ kind: "output", structured: true, language: "json" });

		const diff = normalizeToolPart({
			type: "tool-Edit",
			state: "output-available",
			input: { path: "src/app.ts" },
			output: { diff: "@@\n-old\n+new" },
		});
		expect(diff?.detail).toMatchObject({ kind: "diff", file: "src/app.ts" });

		const todo = normalizeToolPart({
			type: "tool-TodoWrite",
			state: "output-available",
			input: { todos: [{ content: "Ship trace polish", status: "in_progress" }] },
		});
		expect(todo?.detail).toMatchObject({
			kind: "todo",
			items: [{ title: "Ship trace polish", status: "in-progress" }],
		});

		const approval = normalizeToolPart(
			{
				type: "tool-RequestApproval",
				state: "input-streaming",
				input: { approval: { path: "src/app.ts", mode: "write" } },
			},
			"streaming",
		);
		expect(approval?.approval).toEqual({ path: "src/app.ts", mode: "write" });

		const image = normalizeToolPart({
			type: "tool-ImageGeneration",
			state: "output-available",
			output: { image_url: "https://cdn.example.com/image.png" },
		});
		expect(image?.detail).toEqual({ kind: "image", url: "https://cdn.example.com/image.png" });

		const citations = normalizeToolPart({
			type: "tool-WebSearch",
			state: "output-available",
			output: {
				results: [
					{ title: "Safe source", url: "https://example.com/docs" },
					{ title: "Unsafe source", url: "javascript:alert(1)" },
				],
			},
		});
		expect(citations?.detail).toMatchObject({
			kind: "citations",
			citations: [
				{ title: "Safe source", url: "https://example.com/docs" },
				{ title: "Unsafe source", url: undefined },
			],
		});
	});

	it("renders one bounded tool disclosure with concise labels and safe citation rows", () => {
		const codeMarkup = renderToStaticMarkup(
			createElement(CodeBlock, { code: "first\n\nthird\n", status: "streaming" }),
		);
		expect(codeMarkup).toContain('role="log"');
		expect(codeMarkup).toContain("overflow-auto");
		const codeDocument = new DOMParser().parseFromString(codeMarkup, "text/html");
		expect(codeDocument.querySelector('[data-slot="code-block-code"]')?.textContent).toBe("first\n\nthird\n");

		const multiline = renderToStaticMarkup(
			// biome-ignore lint/correctness/noChildrenProp: createElement requires children in props for this component type.
			createElement(ToolResultOutput, { label: "stdout", children: "first line\nsecond line" }),
		);
		expect(multiline).toContain("first line\nsecond line");
		expect(multiline).toContain('data-wrap="true"');
		const reportedErrorMarkup = renderToStaticMarkup(
			// biome-ignore lint/correctness/noChildrenProp: createElement requires children in props for this component type.
			createElement(ToolResultOutput, { label: "reported-error", error: true, children: "command failed" }),
		);
		expect(reportedErrorMarkup).toContain("Reported error");
		expect(reportedErrorMarkup).toContain('data-variant="destructive"');

		const ipythonMarkup = renderToStaticMarkup(
			createElement(SpecializedToolRenderer, {
				part: {
					type: "tool-IPython",
					toolCallId: "python-1",
					state: "input-streaming",
					input: { code: "1 + 1" },
				},
				chatStatus: "streaming",
			}),
		);
		expect(ipythonMarkup).toContain("IPython");
		expect(ipythonMarkup).toContain("Running");
		expect(ipythonMarkup).not.toContain("Running IPython");
		expect(ipythonMarkup).toContain("max-height:160px");
		expect(ipythonMarkup).not.toContain("Ready");

		const outputMarkup = renderToStaticMarkup(
			createElement(SpecializedToolRenderer, {
				part: {
					type: "tool-Bash",
					toolCallId: "bash-1",
					state: "output-available",
					input: { command: "git status" },
					output: { stdout: "clean", stderr: "warning" },
				},
			}),
		);
		expect(outputMarkup).toContain(">stdout<");
		expect(outputMarkup).toContain(">stderr<");

		const citationMarkup = renderToStaticMarkup(
			createElement(SpecializedToolRenderer, {
				part: {
					type: "tool-WebSearch",
					state: "output-available",
					output: {
						results: [
							{ title: "Safe", url: "https://example.com" },
							{ title: "Unsafe", url: "javascript:alert(1)" },
						],
					},
				},
			}),
		);
		expect(citationMarkup).toContain('href="https://example.com"');
		expect(citationMarkup).not.toContain("javascript:");
	});

	it("suppresses raw thinking before the Fleet tool fallback renders it", () => {
		const markup = renderToStaticMarkup(
			createElement(SessionToolRenderer, {
				part: {
					type: "tool-Thinking",
					toolCallId: "thinking-1",
					state: "output-available",
					input: { thought: "private reasoning" },
					output: "private reasoning",
				},
			}),
		);

		expect(markup).toBe("");
	});
});
