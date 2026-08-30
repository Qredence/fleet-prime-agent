import type {
	ChatMessage,
	ChatStatus,
	PrimeAgentArtifact,
	PrimeAgentArtifactKind,
	PrimeAgentArtifactRun,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol";

export type PrimeAgentArtifactDiffLine = {
	id: string;
	type: "added" | "removed" | "context";
	content: string;
};

export type PrimeAgentArtifactDiff = {
	file: string;
	lines: Array<PrimeAgentArtifactDiffLine>;
	copyText: string;
};

function stablePresentationId(seed: string): string {
	let hash = 2166136261;
	for (let index = 0; index < seed.length; index += 1) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `${seed.replace(/[^a-zA-Z0-9:_-]+/g, "-").slice(0, 96)}-${(hash >>> 0).toString(36)}`;
}

function timestampFor(message: ChatMessage): number {
	if (typeof message.createdAt === "number") return message.createdAt;
	if (message.createdAt instanceof Date) return message.createdAt.getTime();
	if (typeof message.createdAt === "string") {
		const parsed = Date.parse(message.createdAt);
		if (Number.isFinite(parsed)) return parsed;
	}
	return 0;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function stringField(source: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
	for (const key of keys) {
		if (typeof source?.[key] === "string") return source[key] as string;
	}
	return undefined;
}

function textContent(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return undefined;
	const text = value
		.flatMap((part) => {
			const source = record(part);
			return typeof source?.text === "string" ? [source.text] : [];
		})
		.join("");
	return text || undefined;
}

function splitLines(
	artifactId: string,
	index: number,
	content: string,
	type: PrimeAgentArtifactDiffLine["type"],
): Array<PrimeAgentArtifactDiffLine> {
	return content.split("\n").map((line, lineIndex) => ({
		id: `${artifactId}-${index}-${type}-${lineIndex}`,
		type,
		content: line,
	}));
}

function filePathFor(artifact: PrimeAgentArtifact): string {
	const input = record(artifact.input);
	const output = record(artifact.output);
	return (
		stringField(input, "path", "file_path", "filePath") ??
		stringField(output, "path", "file_path", "filePath") ??
		artifact.title
	);
}

function unifiedDiffFor(artifact: PrimeAgentArtifact): string | undefined {
	const input = record(artifact.input);
	const output = record(artifact.output);
	const details = record(output?.details);
	return (
		stringField(output, "diff", "patch") ??
		stringField(details, "diff", "patch") ??
		stringField(input, "diff", "patch")
	);
}

function editDiffFor(artifact: PrimeAgentArtifact): Array<PrimeAgentArtifactDiffLine> {
	const input = record(artifact.input);
	const output = record(artifact.output);
	const edits = Array.isArray(input?.edits) ? input.edits : Array.isArray(output?.edits) ? output.edits : [];
	return edits.flatMap((edit, index) => {
		const source = record(edit);
		if (!source) return [];
		const before = stringField(source, "oldText", "old_string", "before");
		const after = stringField(source, "newText", "new_string", "after", "content");
		return [
			...(before === undefined ? [] : splitLines(artifact.id, index, before, "removed")),
			...(after === undefined ? [] : splitLines(artifact.id, index, after, "added")),
		];
	});
}

export function primeAgentArtifactDiff(artifact: PrimeAgentArtifact): PrimeAgentArtifactDiff | undefined {
	const unifiedDiff = unifiedDiffFor(artifact);
	if (unifiedDiff?.trim()) {
		const lines = unifiedDiff.split("\n").map((content, index) => ({
			id: `${artifact.id}-${index}`,
			type:
				content.startsWith("+") && !content.startsWith("+++")
					? ("added" as const)
					: content.startsWith("-") && !content.startsWith("---")
						? ("removed" as const)
						: ("context" as const),
			content,
		}));
		return { file: filePathFor(artifact), lines, copyText: unifiedDiff };
	}

	const editLines = editDiffFor(artifact);
	if (editLines.length > 0) {
		return {
			file: filePathFor(artifact),
			lines: editLines,
			copyText: editLines
				.map((line) => `${line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}${line.content}`)
				.join("\n"),
		};
	}

	const input = record(artifact.input);
	const output = record(artifact.output);
	const isWrite = artifact.title.toLowerCase().includes("write") || input?.content !== undefined;
	if (!isWrite) return undefined;
	const content = textContent(input?.content) ?? textContent(output?.content);
	if (content === undefined) return undefined;
	const lines = splitLines(artifact.id, 0, content, "added");
	return {
		file: filePathFor(artifact),
		lines,
		copyText: lines.map((line) => `+${line.content}`).join("\n"),
	};
}

function artifactKind(name: string): PrimeAgentArtifactKind | undefined {
	const lower = name.toLowerCase();
	if (lower.includes("thinking") || lower.includes("reasoning") || lower.includes("question")) return undefined;
	if (lower.includes("bash") || lower.includes("shell")) return "bash";
	if (lower.includes("ipython") || lower.includes("python")) return "ipython";
	if (lower.includes("mcp")) return "mcp";
	if (lower.includes("edit") || lower.includes("write") || lower.includes("patch")) return "diff";
	return "generic";
}

function statusFor(part: Record<string, unknown>, chatStatus?: ChatStatus): PrimeAgentArtifact["status"] {
	const state = typeof part.state === "string" ? part.state : undefined;
	if (state === "output-error" || state === "error") return "error";
	if (state === "output-available" || state === "complete" || state === "success") return "success";
	if (state === "cancelled" || state === "canceled" || state === "aborted" || state === "interrupted") {
		return "cancelled";
	}
	if (part.error !== undefined) return "error";
	if (part.output !== undefined || part.result !== undefined) return "success";
	return chatStatus === "streaming" ? "running" : "cancelled";
}

function upsertRun(runs: PrimeAgentArtifactRun[], artifact: PrimeAgentArtifact): void {
	const run = runs.find((candidate) => candidate.runId === artifact.runId);
	if (!run) {
		runs.push({
			id: stablePresentationId(`artifact-run:${artifact.runId}`),
			runId: artifact.runId,
			artifacts: [artifact],
			startedAt: artifact.timestamp,
			...(artifact.status !== "running" ? { endedAt: artifact.timestamp } : {}),
		});
		return;
	}
	const existing = run.artifacts.findIndex((candidate) => candidate.id === artifact.id);
	if (existing < 0) run.artifacts.push(artifact);
	else run.artifacts[existing] = artifact;
	if (artifact.status !== "running") run.endedAt = artifact.timestamp;
}

function artifactsFromMessages(messages: Array<ChatMessage>, chatStatus?: ChatStatus): Array<PrimeAgentArtifactRun> {
	const runs: Array<PrimeAgentArtifactRun> = [];
	for (const message of messages) {
		for (const [partIndex, part] of message.parts.entries()) {
			const source = record(part);
			if (!source) continue;
			const type = source?.type;
			if (typeof type !== "string" || !type.startsWith("tool-")) continue;
			const name = type.slice(5);
			const kind = artifactKind(name);
			if (!kind) continue;
			const input = source.input ?? source.args;
			const output = source.output ?? source.result;
			if (input === undefined && output === undefined) continue;
			const sourceId =
				typeof source.toolCallId === "string" && source.toolCallId
					? source.toolCallId
					: `${message.id}:${partIndex}`;
			const runId = typeof source.runId === "string" && source.runId ? source.runId : message.id;
			const timestamp = timestampFor(message);
			upsertRun(runs, {
				id: stablePresentationId(`${runId}:${sourceId}:${kind}`),
				runId,
				sourceMessageId: message.id,
				...(typeof source.toolCallId === "string" ? { sourceToolCallId: source.toolCallId } : {}),
				kind,
				title: name,
				status: statusFor(source, chatStatus),
				...(input !== undefined ? { input } : {}),
				...(output !== undefined ? { output } : {}),
				timestamp,
			});
		}
	}
	return runs;
}

export function derivePrimeAgentArtifactRuns(
	messages: Array<ChatMessage>,
	presentation?: PrimeAgentSessionPresentation,
	chatStatus?: ChatStatus,
): Array<PrimeAgentArtifactRun> {
	const runs = (presentation?.artifactRuns ?? []).map((run) => ({
		...run,
		artifacts: run.artifacts.map((artifact) => ({ ...artifact })),
	}));
	for (const run of artifactsFromMessages(messages, chatStatus)) {
		for (const artifact of run.artifacts) upsertRun(runs, artifact);
	}
	return runs;
}

export function artifactById(
	runs: Array<PrimeAgentArtifactRun>,
	id: string | null | undefined,
): PrimeAgentArtifact | undefined {
	if (!id) return undefined;
	return runs.flatMap((run) => run.artifacts).find((artifact) => artifact.id === id);
}
