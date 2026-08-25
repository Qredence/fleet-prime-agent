import {
	derivePrimeAgentArtifactRuns,
	primeAgentArtifactDiff,
} from "@prime-agent/web-design/components/fleet-pi/pi/prime-agent-artifacts";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol";
import { describe, expect, it } from "vitest";

function artifactStatus(state: string, chatStatus: ChatStatus, extra: Record<string, unknown> = {}) {
	const messages: Array<ChatMessage> = [
		{
			id: "assistant-1",
			role: "assistant",
			parts: [
				{
					type: "tool-Bash",
					toolCallId: "bash-1",
					state,
					input: { command: "git status" },
					...extra,
				},
			],
		},
	];
	return derivePrimeAgentArtifactRuns(messages, undefined, chatStatus)[0]?.artifacts[0]?.status;
}

describe("derivePrimeAgentArtifactRuns", () => {
	it("keeps unresolved tools running only during an active stream", () => {
		expect(artifactStatus("input-streaming", "streaming")).toBe("running");
		expect(artifactStatus("input-available", "streaming")).toBe("running");
		expect(artifactStatus("input-streaming", "ready")).toBe("cancelled");
		expect(artifactStatus("input-available", "error")).toBe("cancelled");
	});

	it("preserves successful, failed, and cancelled terminal states", () => {
		expect(artifactStatus("output-available", "streaming", { output: { stdout: "clean" } })).toBe("success");
		expect(artifactStatus("output-error", "ready", { output: { error: "failed" } })).toBe("error");
		expect(artifactStatus("input-available", "ready", { error: "failed" })).toBe("error");
		expect(artifactStatus("cancelled", "ready")).toBe("cancelled");
		expect(artifactStatus("aborted", "ready")).toBe("cancelled");
		expect(artifactStatus("interrupted", "ready")).toBe("cancelled");
	});

	it("normalizes canonical Prime Edit and Write payloads", () => {
		const messages: Array<ChatMessage> = [
			{
				id: "assistant-edit",
				role: "assistant",
				parts: [
					{
						type: "tool-Edit",
						toolCallId: "edit-1",
						state: "output-available",
						input: {
							path: "src/example.ts",
							edits: [{ oldText: "before", newText: "after" }],
						},
						output: { details: { diff: "@@ -1 +1 @@\n-before\n+after" } },
					},
					{
						type: "tool-Write",
						toolCallId: "write-1",
						state: "output-available",
						input: { path: "src/new.ts", content: "export const value = 1;" },
					},
				],
			},
		];
		const artifacts = derivePrimeAgentArtifactRuns(messages, undefined, "ready")[0]?.artifacts ?? [];

		const editDiff = primeAgentArtifactDiff(artifacts.find((artifact) => artifact.title === "Edit")!);
		const writeDiff = primeAgentArtifactDiff(artifacts.find((artifact) => artifact.title === "Write")!);
		expect(editDiff?.file).toBe("src/example.ts");
		expect(editDiff?.lines.map((line) => [line.type, line.content])).toEqual([
			["context", "@@ -1 +1 @@"],
			["removed", "-before"],
			["added", "+after"],
		]);
		expect(writeDiff?.file).toBe("src/new.ts");
		expect(writeDiff?.lines).toEqual([
			expect.objectContaining({ type: "added", content: "export const value = 1;" }),
		]);
	});
});
