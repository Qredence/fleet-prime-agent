import { isSafeExternalUrl } from "../../../lib/safe-external-url";
import type { AgentCodeLanguage } from "../../agents/agent-code";
import type { CitationItem } from "../../agents/citations";
import type { FileDiffLine } from "../../agents/file-diff";
import type { TodoItem } from "../../agents/todo-list";
import type { ToolResultStatus } from "../../agents/tool-result";

export type FleetToolRecord = Record<string, unknown>;

export interface FleetToolOutputSummary {
	record?: FleetToolRecord;
	details?: FleetToolRecord;
	stdout?: string;
	stderr?: string;
	result?: unknown;
	error?: string;
	durationMs?: number;
	kernelRestarted?: boolean;
	structured: boolean;
}

export type FleetToolDetail =
	| {
			kind: "output";
			content: string;
			language: AgentCodeLanguage;
			structured: boolean;
			sourceCode?: string;
			sourceLanguage?: AgentCodeLanguage;
	  }
	| {
			kind: "diff";
			file: string;
			lines: FileDiffLine[];
			copyText: string;
	  }
	| {
			kind: "todo";
			title: string;
			items: TodoItem[];
	  }
	| {
			kind: "citations";
			citations: CitationItem[];
	  }
	| {
			kind: "image";
			url: string;
	  };

export interface NormalizedFleetToolPart {
	id: string;
	name: string;
	lowerName: string;
	status: ToolResultStatus;
	input?: FleetToolRecord;
	output?: unknown;
	outputSummary: FleetToolOutputSummary;
	command?: string;
	metadata: string[];
	approval?: FleetToolRecord;
	detail?: FleetToolDetail;
}

function asRecord(value: unknown): FleetToolRecord | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as FleetToolRecord) : undefined;
}

function parseRecord(value: unknown): FleetToolRecord | undefined {
	const direct = asRecord(value);
	if (direct) return direct;
	if (typeof value !== "string") return undefined;

	try {
		return asRecord(JSON.parse(value));
	} catch {
		return undefined;
	}
}

function getString(record: FleetToolRecord | undefined, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return undefined;
}

function getNumber(record: FleetToolRecord | undefined, ...keys: string[]): number | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && value.trim()) {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return undefined;
}

function getBoolean(record: FleetToolRecord | undefined, ...keys: string[]): boolean | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (typeof value === "boolean") return value;
	}
	return undefined;
}

export function stringifyToolValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function getOutput(part: FleetToolRecord): unknown {
	if (part.output !== undefined && part.output !== null) return part.output;
	return part.result;
}

function summarizeOutput(output: unknown): FleetToolOutputSummary {
	const record = parseRecord(output);
	const details = parseRecord(record?.details);
	const fields: FleetToolRecord = {
		...(record ?? {}),
		...(details ?? {}),
	};
	const result = fields.result;
	const stdout = getString(fields, "stdout", "standardOutput", "standard_output");
	const stderr = getString(fields, "stderr", "standardError", "standard_error");
	const errorValue = fields.error ?? fields.errorMessage ?? fields.evalue;
	const error = errorValue === undefined ? undefined : stringifyToolValue(errorValue);
	const durationMs = getNumber(fields, "durationMs", "duration_ms", "duration");
	const kernelRestarted = getBoolean(fields, "kernelRestarted", "kernel_restarted");
	const structuredKeys = new Set([
		"stdout",
		"stderr",
		"standardOutput",
		"standard_output",
		"standardError",
		"standard_error",
		"error",
		"errorMessage",
		"evalue",
		"durationMs",
		"duration_ms",
		"duration",
		"kernelRestarted",
		"kernel_restarted",
		"status",
		"isError",
	]);
	const hasStructuredFields = Object.keys(fields).some((key) => !structuredKeys.has(key));
	const structured =
		!stdout && !stderr && !error && ((typeof result === "object" && result !== null) || hasStructuredFields);

	return {
		record,
		details,
		stdout,
		stderr,
		result,
		error,
		durationMs,
		kernelRestarted,
		structured,
	};
}

function getOutputContent(summary: FleetToolOutputSummary, output: unknown): string {
	const sections: string[] = [];
	if (summary.stdout) sections.push(`stdout\n${summary.stdout}`);
	if (summary.stderr) sections.push(`stderr\n${summary.stderr}`);
	if (summary.result !== undefined) sections.push(`result\n${stringifyToolValue(summary.result)}`);
	if (summary.error) sections.push(`error\n${summary.error}`);
	if (sections.length > 0) return sections.join("\n\n");

	const record = summary.details ?? summary.record;
	if (record) {
		const withoutEnvelope = { ...record };
		delete withoutEnvelope.details;
		delete withoutEnvelope.isError;
		if (Object.keys(withoutEnvelope).length > 0) return stringifyToolValue(withoutEnvelope);
	}
	return stringifyToolValue(output);
}

function getInput(part: FleetToolRecord): FleetToolRecord | undefined {
	return parseRecord(part.input) ?? parseRecord(part.args);
}

function getArray(record: FleetToolRecord | undefined, ...keys: string[]): unknown[] | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (Array.isArray(value)) return value;
	}
	return undefined;
}

function getDiff(input: FleetToolRecord | undefined, summary: FleetToolOutputSummary): string | undefined {
	return getString(summary.details ?? summary.record, "diff", "patch") ?? getString(input, "diff", "patch");
}

function getFilePath(input: FleetToolRecord | undefined, summary: FleetToolOutputSummary): string {
	return (
		getString(input, "path", "filePath", "filename", "file") ??
		getString(summary.details ?? summary.record, "path", "filePath", "filename", "file") ??
		"workspace file"
	);
}

export function parseDiffLines(diff: string): FileDiffLine[] {
	return diff.split("\n").map((content, index) => ({
		id: `${index}-${content.slice(0, 16)}`,
		type:
			content.startsWith("+") && !content.startsWith("+++")
				? "added"
				: content.startsWith("-") && !content.startsWith("---")
					? "removed"
					: "context",
		content,
	}));
}

function getTodos(input: FleetToolRecord | undefined, summary: FleetToolOutputSummary): TodoItem[] {
	const output = summary.details ?? summary.record;
	const plan = parseRecord(input?.plan) ?? parseRecord(output?.plan);
	const source =
		getArray(input, "todos") ?? getArray(plan, "todos", "items") ?? getArray(output, "todos", "newTodos", "items");
	if (!source) return [];

	return source.flatMap((item, index) => {
		const record = asRecord(item);
		if (!record) return [];
		const title = getString(record, "content", "title", "text", "label");
		if (!title) return [];
		const rawStatus = getString(record, "status");
		const status =
			rawStatus === "in_progress"
				? "in-progress"
				: rawStatus === "completed"
					? "completed"
					: rawStatus === "cancelled"
						? "cancelled"
						: "pending";
		return [{ id: `${index}-${title}`, title, status } satisfies TodoItem];
	});
}

function getCitations(summary: FleetToolOutputSummary): CitationItem[] {
	const output = summary.details ?? summary.record;
	const source = getArray(output, "results", "sources", "citations");
	if (!source) return [];

	return source.flatMap((item, index) => {
		const record = asRecord(item);
		if (!record) return [];
		const title = getString(record, "title", "name", "snippet");
		if (!title) return [];
		const rawUrl = getString(record, "url", "link");
		const url = rawUrl && isSafeExternalUrl(rawUrl) ? rawUrl : undefined;
		return [
			{
				id: `${index}-${title}`,
				title,
				url,
				domain: getString(record, "domain", "source"),
			},
		];
	});
}

function getImageUrl(summary: FleetToolOutputSummary): string | undefined {
	return getString(summary.details ?? summary.record, "url", "imageUrl", "image_url");
}

function getApproval(input: FleetToolRecord | undefined, summary: FleetToolOutputSummary): FleetToolRecord | undefined {
	return asRecord(input?.approval) ?? asRecord(summary.details?.approval) ?? asRecord(summary.record?.approval);
}

function toolName(part: FleetToolRecord): string {
	const type = typeof part.type === "string" ? part.type : "Tool";
	return type.startsWith("tool-") ? type.slice(5) : type;
}

function resultStatus(part: FleetToolRecord, chatStatus?: string): ToolResultStatus {
	const state = typeof part.state === "string" ? part.state : undefined;
	if (state === "output-error" || state === "error") return "error";
	if (state === "output-available" || state === "complete" || state === "success") return "success";
	if (state === "cancelled" || state === "canceled" || state === "aborted" || state === "interrupted")
		return "cancelled";
	if (part.error !== undefined) return "error";
	if (state === "input-streaming" || state === "streaming") {
		return chatStatus === "streaming" ? "running" : "cancelled";
	}
	if (part.output !== undefined || part.result !== undefined) return "success";
	return chatStatus === "streaming" ? "running" : "cancelled";
}

function languageFor(name: string, structured: boolean): AgentCodeLanguage {
	if (structured || name.toLowerCase().includes("json")) return "json";
	if (name.toLowerCase().includes("bash") || name.toLowerCase().includes("shell")) return "bash";
	return "text";
}

export function normalizeFleetToolPart(part: unknown, chatStatus?: string): NormalizedFleetToolPart | undefined {
	const source = asRecord(part);
	if (!source) return undefined;
	const name = toolName(source);
	const lowerName = name.toLowerCase();
	const input = getInput(source);
	const output = getOutput(source);
	const outputSummary = summarizeOutput(output);
	const status = resultStatus(source, chatStatus);
	const command = getString(input, "command", "cmd", "code", "script");
	const thought = getString(input, "thought", "text");
	const metadata: string[] = [];
	if (outputSummary.durationMs !== undefined) metadata.push(`${outputSummary.durationMs}ms`);
	if (outputSummary.kernelRestarted) metadata.push("kernel restarted");

	const diff = getDiff(input, outputSummary);
	const todos = lowerName.includes("todo") || lowerName.includes("plan") ? getTodos(input, outputSummary) : [];
	const citations =
		lowerName.includes("search") ||
		lowerName.includes("web") ||
		lowerName.includes("source") ||
		lowerName.includes("citation")
			? getCitations(outputSummary)
			: [];
	const imageUrl =
		lowerName.includes("image") || lowerName.includes("generat") ? getImageUrl(outputSummary) : undefined;
	const approval = getApproval(input, outputSummary);
	const content =
		getOutputContent(outputSummary, output) ||
		(lowerName === "thinking" || lowerName === "reasoning" ? (thought ?? "") : "");
	const hasOutputContent = Boolean(content.trim());
	const id =
		typeof source.toolCallId === "string" && source.toolCallId
			? source.toolCallId
			: `${name}-${JSON.stringify(input ?? {})}`;

	let detail: FleetToolDetail | undefined;
	if (todos.length > 0) {
		detail = { kind: "todo", title: lowerName.includes("plan") ? "Plan" : "Todo list", items: todos };
	} else if (citations.length > 0) {
		detail = { kind: "citations", citations };
	} else if (imageUrl) {
		detail = { kind: "image", url: imageUrl };
	} else if (diff && (lowerName.includes("edit") || lowerName.includes("write") || lowerName.includes("patch"))) {
		detail = { kind: "diff", file: getFilePath(input, outputSummary), lines: parseDiffLines(diff), copyText: diff };
	} else if (command || hasOutputContent || approval || metadata.length > 0) {
		detail = {
			kind: "output",
			content,
			language: languageFor(name, outputSummary.structured),
			structured: outputSummary.structured,
			sourceCode: command,
			sourceLanguage: command && (lowerName.includes("bash") || lowerName.includes("shell")) ? "bash" : "text",
		};
	}

	return {
		id,
		name,
		lowerName,
		status,
		input,
		output,
		outputSummary,
		command,
		metadata,
		approval,
		detail,
	};
}
