import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalizeFleetToolPart } from "../../../../design/src/components/product/fleet-pi/chat/beui-tool-normalizer";
import { BeuiToolRenderer } from "../../../../design/src/components/product/fleet-pi/chat/beui-tool-renderer";
import { FleetPiToolRenderer } from "../../../../design/src/components/product/fleet-pi/chat/fleet-pi-tool-renderer";

describe("normalizeFleetToolPart", () => {
	it("extracts nested IPython details and keeps an active unresolved call running", () => {
		const normalized = normalizeFleetToolPart(
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

		const python = normalizeFleetToolPart({
			type: "tool-IPython",
			state: "output-available",
			input: { code: "value = 1" },
			output: { details: { stdout: "1" } },
		});
		expect(python?.detail).toMatchObject({ sourceLanguage: "python", sourceLabel: "IPython" });
	});

	it("gives terminal states precedence over the global streaming status", () => {
		expect(
			normalizeFleetToolPart(
				{
					type: "tool-Bash",
					state: "output-available",
					output: { stdout: "done" },
				},
				"streaming",
			)?.status,
		).toBe("success");
		expect(normalizeFleetToolPart({ type: "tool-Bash", state: "input-streaming" })?.status).toBe("cancelled");
		expect(normalizeFleetToolPart({ type: "tool-Bash", state: "input-streaming" }, "streaming")?.status).toBe(
			"running",
		);
		expect(
			normalizeFleetToolPart({
				type: "tool-Bash",
				state: "output-error",
				output: { error: "command failed" },
			})?.status,
		).toBe("error");
		expect(normalizeFleetToolPart({ type: "tool-Bash", state: "aborted" })?.status).toBe("cancelled");
	});

	it("maps structured results, diffs, todos, approvals, images, and citations", () => {
		const json = normalizeFleetToolPart({
			type: "tool-InspectJson",
			state: "output-available",
			result: { version: 2, enabled: true },
		});
		expect(json?.detail).toMatchObject({ kind: "output", structured: true, language: "json" });

		const diff = normalizeFleetToolPart({
			type: "tool-Edit",
			state: "output-available",
			input: { path: "src/app.ts" },
			output: { diff: "@@\n-old\n+new" },
		});
		expect(diff?.detail).toMatchObject({ kind: "diff", file: "src/app.ts" });

		const todo = normalizeFleetToolPart({
			type: "tool-TodoWrite",
			state: "output-available",
			input: { todos: [{ content: "Ship trace polish", status: "in_progress" }] },
		});
		expect(todo?.detail).toMatchObject({
			kind: "todo",
			items: [{ title: "Ship trace polish", status: "in-progress" }],
		});

		const approval = normalizeFleetToolPart(
			{
				type: "tool-RequestApproval",
				state: "input-streaming",
				input: { approval: { path: "src/app.ts", mode: "write" } },
			},
			"streaming",
		);
		expect(approval?.approval).toEqual({ path: "src/app.ts", mode: "write" });

		const image = normalizeFleetToolPart({
			type: "tool-ImageGeneration",
			state: "output-available",
			output: { image_url: "https://cdn.example.com/image.png" },
		});
		expect(image?.detail).toEqual({ kind: "image", url: "https://cdn.example.com/image.png" });

		const citations = normalizeFleetToolPart({
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
		const ipythonMarkup = renderToStaticMarkup(
			createElement(BeuiToolRenderer, {
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
			createElement(BeuiToolRenderer, {
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
			createElement(BeuiToolRenderer, {
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
			createElement(FleetPiToolRenderer, {
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
